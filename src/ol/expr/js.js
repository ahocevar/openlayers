/**
 * @module ol/expr/js
 */
import {asArray} from '../color.js';
import {
  CallExpression,
  ColorType,
  NumberType,
  Ops,
  parse,
} from './expression.js';

/**
 * @fileoverview Compiles expressions to JavaScript source, the way {@link module:ol/expr/gpu}
 * compiles them to GLSL.  The source is baked into a worker at style time, so the per-pixel loop
 * runs one specialised function instead of walking the tree of closures that
 * {@link module:ol/expr/cpu} builds.
 *
 * Two things shape the design:
 *
 * A compiled expression is a value *and* the statements that value depends on, never a bare
 * string.  Some operators need a subexpression named before it can be used twice or tested by a
 * branch, and those statements have to be placed by whoever consumes the value.  Carrying them
 * in the return type is what makes that placement impossible to forget: an operator that is
 * always evaluated concatenates its parts' statements with {@link combine}, while one that
 * branches puts them inside the branch that needs them.  Getting this wrong costs no
 * correctness — these expressions are pure — so no test of what a style renders can see it, only
 * the variable read counts in the tests and the benchmarks can.
 *
 * A color is four channel expressions rather than an array, so a color is never allocated or
 * indexed per pixel.  Numbers and booleans use the same shape with a single channel, which lets
 * the branching machinery serve both.
 *
 * The emitted code reads a fixed set of names, which the surrounding loop must provide:
 * `data` (the band values), `offset` (the index of the current pixel's first band),
 * `bandCount`, `bandScale`, `resolution`, and `vars` (the style variables).  A style reading a neighbouring
 * pixel also needs `col`, `row`, `width` and `height`, which the loop only has to track when
 * `needsPosition` says so.  Style variables are read from `vars` at
 * evaluation time rather than folded in as literals, so changing them needs no recompilation.
 * A variable used as a color has to be in `vars` as an rgba array, because resolving a css
 * color needs {@link module:ol/color}, which a worker built from source cannot import.
 */

/**
 * A compiled expression: one source string per channel, and the statements that must run
 * before they are evaluated.  Numbers and booleans have one channel; colors have four, with
 * RGB in the 0 to 255 range and alpha in 0 to 1, as everywhere else in the library.
 *
 * @typedef {Object} Compiled
 * @property {Array<string>} value The source for each channel.
 * @property {Array<string>} statements The statements the value depends on.
 */

/**
 * Only holds what is genuinely global to one compilation.  Constants are loop-invariant by
 * construction — they close over nothing from the per-pixel loop — so unlike statements they
 * carry no placement hazard and can be collected here.
 *
 * @typedef {Object} CompilationContext
 * @property {Array<string>} constants Statements to emit once, outside the per-pixel loop.
 * @property {number} counter Source of unique temporary names.
 * @property {boolean} needsPosition Whether the emitted code reads `col` and `row`, which
 * only a band expression with an offset does.
 * @property {boolean} needsHcl Whether the emitted code calls `mixHcl`, which only
 * `interpolate-hcl` does.
 */

/**
 * @return {CompilationContext} A new compilation context.
 */
export function newCompilationContext() {
  return {
    constants: [],
    counter: 0,
    needsPosition: false,
    needsHcl: false,
  };
}

/**
 * The source of `mixHcl`, to be emitted alongside a style whose context comes back with
 * `needsHcl`.  It is a transcription of `interpolateHclColor` and the color conversions it
 * uses in {@link module:ol/color}, kept here because the emitted code has to stand on its own
 * in a worker built from source, where nothing can be imported.
 *
 * @type {string}
 */
export const HCL_HELPERS = `function hclA1(v) {
  return v > 10.314724 ? Math.pow((v + 14.025) / 269.025, 2.4) : v / 3294.6;
}
function hclA2(v) {
  return v > 0.0088564 ? Math.pow(v, 1 / 3) : v / (108 / 841) + 4 / 29;
}
function hclB1(v) {
  return v > 0.0031308 ? Math.pow(v, 1 / 2.4) * 269.025 - 14.025 : v * 3294.6;
}
function hclB2(v) {
  return v > 0.2068965 ? Math.pow(v, 3) : (v - 4 / 29) * (108 / 841);
}
function toLcha(red, green, blue) {
  const r = hclA1(red);
  const g = hclA1(green);
  const b = hclA1(blue);
  const y = hclA2(r * 0.222488403 + g * 0.716873169 + b * 0.06060791);
  const l = 500 * (hclA2(r * 0.452247074 + g * 0.399439023 + b * 0.148375274) - y);
  const q = 200 * (y - hclA2(r * 0.016863605 + g * 0.117638439 + b * 0.865350722));
  const h = Math.atan2(q, l) * (180 / Math.PI);
  return [116 * y - 16, Math.sqrt(l * l + q * q), h < 0 ? h + 360 : h];
}
function clamp255(v) {
  const rounded = (v + 0.5) | 0;
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}
function mixHcl(red1, green1, blue1, alpha1, red2, green2, blue2, alpha2, f) {
  const from = toLcha(red1, green1, blue1);
  const to = toLcha(red2, green2, blue2);
  let deltaHue = to[2] - from[2];
  if (deltaHue > 180) {
    deltaHue -= 360;
  } else if (deltaHue < -180) {
    deltaHue += 360;
  }
  const l = (from[0] + (to[0] - from[0]) * f + 16) / 116;
  const c = from[1] + (to[1] - from[1]) * f;
  const h = ((from[2] + deltaHue * f) * Math.PI) / 180;
  const y = hclB2(l);
  const x = hclB2(l + (c / 500) * Math.cos(h));
  const z = hclB2(l - (c / 200) * Math.sin(h));
  return [
    clamp255(hclB1(x * 3.021973625 - y * 1.617392459 - z * 0.404875592)),
    clamp255(hclB1(x * -0.943766287 + y * 1.916279586 + z * 0.027607165)),
    clamp255(hclB1(x * 0.069407491 - y * 0.22898585 + z * 1.159737864)),
    alpha1 + (alpha2 - alpha1) * f,
  ];
}`;

/**
 * @param {CompilationContext} context The compilation context.
 * @return {string} A name not used by any other temporary.
 */
function name(context) {
  return `t${context.counter++}`;
}

/**
 * @param {string} source The source for a single value.
 * @return {Compiled} A compiled expression needing no statements.
 */
function plain(source) {
  return {value: [source], statements: []};
}

/**
 * Combine parts that are all evaluated, concatenating their statements.  A branching operator
 * must not use this for its arms — their statements belong inside the branch.
 *
 * @param {Array<Compiled>} parts The compiled parts.
 * @param {function(Array<Array<string>>): Array<string>} build Builds the value from the parts'.
 * @return {Compiled} The combined expression.
 */
function combine(parts, build) {
  return {
    statements: parts.flatMap((part) => part.statements),
    value: build(parts.map((part) => part.value)),
  };
}

/**
 * {@link combine} for parts that are all single valued.
 * @param {Array<Compiled>} parts The compiled parts.
 * @param {function(Array<string>): string} build Builds the value from the parts'.
 * @return {Compiled} The combined expression.
 */
function combineScalar(parts, build) {
  return combine(parts, (values) => [build(values.map((value) => value[0]))]);
}

/**
 * Name a value, so it can be used more than once without being evaluated again.
 * @param {Compiled} compiled The expression to name.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The named expression.
 */
function hoist(compiled, context) {
  const temporary = name(context);
  return {
    value: [temporary],
    statements: [
      ...compiled.statements,
      `const ${temporary} = ${compiled.value[0]};`,
    ],
  };
}

/**
 * @param {import('./expression.js').Expression} expression The expression.
 * @return {import('./expression.js').LiteralExpression} The expression as a literal.
 */
function asLiteral(expression) {
  return /** @type {import('./expression.js').LiteralExpression} */ (
    expression
  );
}

/**
 * @param {import('./expression.js').CallExpression} expression The `var` expression.
 * @return {string} The source reading the variable.
 */
function variable(expression) {
  return `vars[${JSON.stringify(asLiteral(expression.args[0]).value)}]`;
}

/**
 * @param {import('./expression.js').Expression} expression The number expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled number.
 */
function compileNumber(expression, context) {
  if (!(expression instanceof CallExpression)) {
    const literal = asLiteral(expression);
    if ((literal.type & NumberType) === 0) {
      throw new Error(`Expected a number, got type ${literal.type}`);
    }
    return plain(String(literal.value));
  }

  const args = expression.args;

  /**
   * @param {string} operator The JavaScript operator.
   * @return {Compiled} The folded expression.
   */
  function fold(operator) {
    return combineScalar(
      args.map((arg) => compileNumber(arg, context)),
      (values) => `(${values.join(` ${operator} `)})`,
    );
  }

  /**
   * @param {string} fn The Math function name.
   * @return {Compiled} The call expression.
   */
  function math(fn) {
    return combineScalar(
      args.map((arg) => compileNumber(arg, context)),
      (values) => `Math.${fn}(${values.join(', ')})`,
    );
  }

  switch (expression.operator) {
    case Ops.Band: {
      const parts = args.map((arg) => compileNumber(arg, context));
      if (parts.length === 1) {
        return combineScalar(
          parts,
          (values) => `(data[offset + ${values[0]} - 1] * bandScale)`,
        );
      }
      // reading a neighbour needs the pixel's position, and clamps to the tile edges the way
      // sampling a texture does
      context.needsPosition = true;
      return combineScalar(parts, (values) => {
        const column = `Math.min(Math.max(col + ${values[1]}, 0), width - 1)`;
        const line = `Math.min(Math.max(row + ${values[2] ?? '0'}, 0), height - 1)`;
        return `(data[(${line} * width + ${column}) * bandCount + ${values[0]} - 1] * bandScale)`;
      });
    }
    case Ops.Var:
      return plain(variable(expression));
    case Ops.Resolution:
      return plain('resolution');
    case Ops.Multiply:
      return fold('*');
    case Ops.Divide:
      return fold('/');
    case Ops.Add:
      return fold('+');
    case Ops.Subtract:
      return fold('-');
    case Ops.Mod:
      return fold('%');
    case Ops.Abs:
      return math('abs');
    case Ops.Floor:
      return math('floor');
    case Ops.Ceil:
      return math('ceil');
    case Ops.Round:
      return math('round');
    case Ops.Sqrt:
      return math('sqrt');
    case Ops.Sin:
      return math('sin');
    case Ops.Cos:
      return math('cos');
    case Ops.Pow:
      return math('pow');
    case Ops.Atan:
      return args.length === 2 ? math('atan2') : math('atan');
    case Ops.Clamp:
      return combineScalar(
        args.map((arg) => compileNumber(arg, context)),
        (values) =>
          `Math.min(Math.max(${values[0]}, ${values[1]}), ${values[2]})`,
      );
    case Ops.Interpolate:
      return compileInterpolate(expression, context, compileNumber);
    case Ops.Case:
    case Ops.Match:
      return compileBranching(expression, context, compileNumber);
    case Ops.Coalesce:
    case Ops.Number:
    case Ops.String:
      return compileAssertion(expression, context);
    case Ops.Get:
    case Ops.Has:
    case Ops.Id:
    case Ops.GeometryType:
    case Ops.LineMetric:
      throw new Error(
        `The '${expression.operator}' operator reads feature data, which a raster style has none of`,
      );
    case Ops.Concat:
    case Ops.ToString:
      throw new Error(
        `The '${expression.operator}' operator builds a string, which a raster style has no use for`,
      );
    default:
      throw new Error(
        `No compiler defined for operator ${expression.operator}`,
      );
  }
}

/**
 * Compile an operand of a comparison, which may be a number or a string.
 * @param {import('./expression.js').Expression} expression The expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled value.
 */
function compileValue(expression, context) {
  if (!(expression instanceof CallExpression)) {
    const value = asLiteral(expression).value;
    return plain(
      typeof value === 'string' ? JSON.stringify(value) : String(value),
    );
  }
  // `var` reads through to whatever the variable holds, so it serves both types
  return compileNumber(expression, context);
}

/**
 * @param {import('./expression.js').Expression} expression The boolean expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled boolean.
 */
function compileBoolean(expression, context) {
  if (!(expression instanceof CallExpression)) {
    return plain(asLiteral(expression).value ? 'true' : 'false');
  }

  const args = expression.args;

  /**
   * @param {string} operator The JavaScript comparison operator.
   * @return {Compiled} The comparison.
   */
  function compare(operator) {
    return combineScalar(
      [compileValue(args[0], context), compileValue(args[1], context)],
      (values) => `(${values[0]} ${operator} ${values[1]})`,
    );
  }

  /**
   * @param {string} operator The JavaScript logical operator.
   * @return {Compiled} The combined condition.
   */
  function logical(operator) {
    return combineScalar(
      args.map((arg) => compileBoolean(arg, context)),
      (values) => `(${values.join(` ${operator} `)})`,
    );
  }

  switch (expression.operator) {
    case Ops.Var:
      // a variable holds a real boolean here, unlike the float uniform a shader gets
      return plain(variable(expression));
    case Ops.Equal:
      return compare('===');
    case Ops.NotEqual:
      return compare('!==');
    case Ops.LessThan:
      return compare('<');
    case Ops.LessThanOrEqualTo:
      return compare('<=');
    case Ops.GreaterThan:
      return compare('>');
    case Ops.GreaterThanOrEqualTo:
      return compare('>=');
    case Ops.Not:
      return combineScalar(
        [compileBoolean(args[0], context)],
        (values) => `(!${values[0]})`,
      );
    case Ops.Any:
      return logical('||');
    case Ops.All:
      return logical('&&');
    case Ops.In: {
      if (args.length < 2) {
        // an empty haystack matches nothing
        return plain('false');
      }
      // the needle is compared with every item, so it is named rather than evaluated again
      const needle = hoist(compileValue(args[0], context), context);
      return combineScalar(
        [needle, ...args.slice(1).map((arg) => compileValue(arg, context))],
        (values) =>
          `(${values
            .slice(1)
            .map((item) => `${values[0]} === ${item}`)
            .join(' || ')})`,
      );
    }
    case Ops.Between: {
      // the value is tested twice, so it is named rather than evaluated again
      const value = hoist(compileNumber(args[0], context), context);
      return combineScalar(
        [
          value,
          compileNumber(args[1], context),
          compileNumber(args[2], context),
        ],
        (values) =>
          `(${values[0]} >= ${values[1]} && ${values[0]} <= ${values[2]})`,
      );
    }
    default:
      throw new Error(
        `No boolean compiler defined for operator ${expression.operator}`,
      );
  }
}

/**
 * Build an `if`/`else` chain assigning to temporaries.  Branching operators cannot be
 * expressions, because only the taken branch may be evaluated.  Each test and each arm brings
 * its own statements into the block where it belongs, so nothing is computed for a branch not
 * taken.
 *
 * @param {Array<{test: Compiled, arm: Compiled}>} branches The branches, in order.
 * @param {Compiled} fallback The value used when no branch matches.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The names holding the result, and the chain that fills them.
 */
function emitBranches(branches, fallback, context) {
  const names = fallback.value.map(() => name(context));

  /**
   * @param {Compiled} compiled The value to assign.
   * @return {string} The statements and the assignments.
   */
  function body(compiled) {
    const assignments = names
      .map((target, i) => `${target} = ${compiled.value[i]};`)
      .join(' ');
    return [...compiled.statements, assignments].join('\n');
  }

  /**
   * @param {number} index The branch to build.
   * @return {string} The block source.
   */
  function build(index) {
    if (index === branches.length) {
      return `{\n${body(fallback)}\n}`;
    }
    const branch = branches[index];
    return `{
${branch.test.statements.join('\n')}
if (${branch.test.value[0]}) {
${body(branch.arm)}
} else ${build(index + 1)}
}`;
  }

  return {
    value: names,
    statements: [`let ${names.join(', ')};`, build(0)],
  };
}

/**
 * Compile `coalesce`, `number` or `string`, which answer with the first argument that passes a
 * test.  Like `case`, an argument may only be evaluated if every argument before it failed, so
 * this is a branch chain rather than a chain of `??`.  Falling off the end throws, the way
 * ol/expr/cpu does.
 *
 * @param {import('./expression.js').CallExpression} expression The expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled expression.
 */
function compileAssertion(expression, context) {
  const operator = expression.operator;
  if ((expression.type & ColorType) !== 0) {
    // a color is four channels here, never a value that could be missing or of another type
    throw new Error(`The '${operator}' operator cannot be used with colors`);
  }

  /**
   * @param {string} candidate The name holding the candidate value.
   * @return {string} The test source.
   */
  function test(candidate) {
    if (operator === Ops.Coalesce) {
      return `${candidate} !== undefined && ${candidate} !== null`;
    }
    return `typeof ${candidate} === ${JSON.stringify(operator)}`;
  }

  const branches = expression.args.map((arg) => {
    // naming the candidate is what lets the test and the arm share one evaluation
    const candidate = hoist(compileValue(arg, context), context);
    return {
      test: {
        value: [test(candidate.value[0])],
        statements: candidate.statements,
      },
      arm: {value: [candidate.value[0]], statements: []},
    };
  });

  const message = JSON.stringify(
    operator === Ops.Coalesce
      ? 'Expected one of the values to be non-null'
      : `Expected one of the values to be a ${operator}`,
  );
  return emitBranches(
    branches,
    plain(`(() => {throw new Error(${message});})()`),
    context,
  );
}

/**
 * @typedef {function(import('./expression.js').Expression, CompilationContext): Compiled} Compiler
 */

/**
 * Compile a `case` or `match` expression, whose arms may be numbers or colors.
 * @param {import('./expression.js').CallExpression} expression The expression.
 * @param {CompilationContext} context The compilation context.
 * @param {Compiler} compileArm Compiles an arm.
 * @return {Compiled} The compiled expression.
 */
function compileBranching(expression, context, compileArm) {
  const args = expression.args;
  const isMatch = expression.operator === Ops.Match;
  // a match compares one value against every case, so it is named rather than evaluated again
  const subject = isMatch
    ? hoist(compileValue(args[0], context), context)
    : null;

  const branches = [];
  for (let i = isMatch ? 1 : 0; i < args.length - 1; i += 2) {
    const test = subject
      ? combineScalar(
          [compileValue(args[i], context)],
          (values) => `${subject.value[0]} === ${values[0]}`,
        )
      : compileBoolean(args[i], context);
    branches.push({test: test, arm: compileArm(args[i + 1], context)});
  }
  const fallback = compileArm(args[args.length - 1], context);
  const chain = emitBranches(branches, fallback, context);
  return subject
    ? {
        value: chain.value,
        statements: [...subject.statements, ...chain.statements],
      }
    : chain;
}

/**
 * Compile an `interpolate` expression, whose stops may be numbers or colors.  Like `case`, only
 * the segment the value falls in may be evaluated, so this is an `if`/`else` chain and each
 * segment carries the statements for the two stops it interpolates between.  Adjacent segments
 * therefore repeat one stop's statements in the source, but each block is its own scope and only
 * one of them ever runs.
 *
 * @param {import('./expression.js').CallExpression} expression The expression.
 * @param {CompilationContext} context The compilation context.
 * @param {Compiler} compileStop Compiles a stop value.
 * @return {Compiled} The compiled expression.
 */
function compileInterpolate(expression, context, compileStop) {
  const args = expression.args;
  // the parser resolves `['linear']` to 1 and `['exponential', base]` to the base, always as
  // a literal number
  const base = Number(asLiteral(args[0]).value);
  const hcl = expression.operator === Ops.InterpolateHcl;
  if (hcl) {
    context.needsHcl = true;
  }

  // the value is tested against every stop, so it is named rather than evaluated again
  const subject = hoist(compileNumber(args[1], context), context);
  const value = subject.value[0];

  const count = (args.length - 2) / 2;
  /** @type {Array<Compiled>} */
  const inputs = [];
  /** @type {Array<Compiled>} */
  const outputs = [];
  for (let i = 0; i < count; ++i) {
    // each stop is named where it is first tested, so the segment that uses it as its low end
    // reads the name instead of evaluating it again.  A branch is nested inside the previous
    // branch's `else`, so the name is still in scope there.
    inputs.push(hoist(compileNumber(args[2 + i * 2], context), context));
    outputs.push(compileStop(args[3 + i * 2], context));
  }

  const branches = [
    {
      // below the first stop the first value is used as it is
      test: {
        value: [`${value} <= ${inputs[0].value[0]}`],
        statements: inputs[0].statements,
      },
      arm: outputs[0],
    },
  ];
  for (let i = 1; i < count; ++i) {
    const low = inputs[i - 1].value[0];
    const high = inputs[i].value[0];
    const factor = name(context);
    // `interpolateNumber` in ol/expr/cpu guards against a segment of no width, which cannot
    // happen here: this branch is only taken when the value is above the low stop and at or
    // below the high one, which two equal stops can never both satisfy
    const ratio =
      base === 1
        ? `(${value} - ${low}) / (${high} - ${low})`
        : `(Math.pow(${base}, ${value} - ${low}) - 1) / ` +
          `(Math.pow(${base}, ${high} - ${low}) - 1)`;
    const factorStatement = `const ${factor} = ${ratio};`;

    // the low end appears twice in the interpolation, so it is named first
    const starts = outputs[i - 1].value.map(() => name(context));
    const startStatements = [
      ...outputs[i - 1].statements,
      ...outputs[i].statements,
      ...starts.map(
        (start, channel) =>
          `const ${start} = ${outputs[i - 1].value[channel]};`,
      ),
      factorStatement,
    ];

    let arm;
    if (hcl) {
      // hue is an angle, so the channels cannot be mixed one by one.  The helper is the only
      // place a color is materialised as an array, and only for the segment actually taken.
      const mixed = name(context);
      arm = {
        statements: [
          ...startStatements,
          `const ${mixed} = mixHcl(${starts.join(', ')}, ` +
            `${outputs[i].value.join(', ')}, ${factor});`,
        ],
        value: [0, 1, 2, 3].map((channel) => `${mixed}[${channel}]`),
      };
    } else {
      arm = {
        statements: startStatements,
        value: starts.map(
          (start, channel) =>
            `${start} + (${outputs[i].value[channel]} - ${start}) * ${factor}`,
        ),
      };
    }

    branches.push({
      // the previous stop was already brought into scope by the enclosing test
      test: {
        value: [`${value} <= ${high}`],
        statements: inputs[i].statements,
      },
      arm: arm,
    });
  }

  // NaN fails every test above and falls through to the last stop, matching the stop search
  // in ol/expr/cpu
  const chain = emitBranches(branches, outputs[count - 1], context);
  return {
    value: chain.value,
    statements: [...subject.statements, ...chain.statements],
  };
}

/**
 * @param {import('./expression.js').Expression} expression The color expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled color.
 */
function compileColor(expression, context) {
  if (!(expression instanceof CallExpression)) {
    const array = asArray(
      /** @type {Array<number>|string} */ (asLiteral(expression).value),
    );
    return {
      statements: [],
      value: [
        String(array[0]),
        String(array[1]),
        String(array[2]),
        String(array.length > 3 ? array[3] : 1),
      ],
    };
  }

  const args = expression.args;
  switch (expression.operator) {
    case Ops.Var: {
      // a color variable arrives as an rgba array, so it is named once and then read channel
      // by channel, the same shape every other color has here
      const rgba = hoist(plain(variable(expression)), context);
      const at = rgba.value[0];
      return {
        statements: rgba.statements,
        value: [
          `${at}[0]`,
          `${at}[1]`,
          `${at}[2]`,
          // an array written by hand may leave the alpha out
          `(${at}[3] ?? 1)`,
        ],
      };
    }
    case Ops.Array:
      // a color array is a `vec4` in a shader, so its channels are in the 0 to 1 range
      return combine(
        args.map((arg) => compileNumber(arg, context)),
        (values) => [
          `(${values[0][0]} * 255)`,
          `(${values[1][0]} * 255)`,
          `(${values[2][0]} * 255)`,
          values.length === 4 ? values[3][0] : '1',
        ],
      );
    case Ops.Color: {
      if (args.length < 3) {
        const gray = hoist(compileNumber(args[0], context), context);
        const alpha =
          args.length === 2 ? compileNumber(args[1], context) : plain('1');
        return combine([gray, alpha], (values) => [
          values[0][0],
          values[0][0],
          values[0][0],
          values[1][0],
        ]);
      }
      return combine(
        args.map((arg) => compileNumber(arg, context)),
        (values) => [
          values[0][0],
          values[1][0],
          values[2][0],
          values.length === 4 ? values[3][0] : '1',
        ],
      );
    }
    case Ops.Interpolate:
    case Ops.InterpolateHcl:
      return compileInterpolate(expression, context, compileColor);
    case Ops.Case:
    case Ops.Match:
      return compileBranching(expression, context, compileColor);
    case Ops.Coalesce:
    case Ops.Number:
    case Ops.String:
      // rejected there, with a message saying why a color cannot be asserted
      return compileAssertion(expression, context);
    case Ops.Palette:
      return compilePalette(expression, context);
    default:
      throw new Error(
        `No compiler defined for operator ${expression.operator}`,
      );
  }
}

/**
 * The palette colors are literals, so they are flattened into one table built once outside the
 * per-pixel loop, and the index reads four channels out of it.
 * @param {import('./expression.js').CallExpression} expression The expression.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled color.
 */
function compilePalette(expression, context) {
  const args = expression.args;
  const count = args.length - 1;
  const channels = [];
  for (let i = 0; i < count; ++i) {
    const entry = args[i + 1];
    if (entry instanceof CallExpression) {
      throw new Error('Palette colors must be literals');
    }
    const color = asArray(
      /** @type {Array<number>|string} */ (asLiteral(entry).value),
    );
    channels.push(
      color[0],
      color[1],
      color[2],
      color.length > 3 ? color[3] : 1,
    );
  }

  const table = name(context);
  context.constants.push(`const ${table} = [${channels.join(', ')}];`);

  // sampling the palette texture clamps to its edges
  const index = hoist(
    combineScalar(
      [compileNumber(args[0], context)],
      (values) =>
        `Math.min(Math.max(Math.floor(${values[0]}), 0), ${count - 1}) * 4`,
    ),
    context,
  );
  const at = index.value[0];
  return {
    statements: index.statements,
    value: [
      `${table}[${at}]`,
      `${table}[${at} + 1]`,
      `${table}[${at} + 2]`,
      `${table}[${at} + 3]`,
    ],
  };
}

/**
 * Compile a number expression to JavaScript source.  Throws when the expression uses an operator
 * a raster style has no data for.
 *
 * @param {import('./expression.js').EncodedExpression} encoded The encoded expression.
 * @param {import('./expression.js').ParsingContext} parsingContext The parsing context.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled number.
 */
export function numberToJs(encoded, parsingContext, context) {
  return compileNumber(parse(encoded, NumberType, parsingContext), context);
}

/**
 * Compile a color expression to JavaScript source, as four channel expressions.  Throws when
 * the expression uses something the emitter does not handle yet.
 *
 * @param {import('./expression.js').EncodedExpression} encoded The encoded expression.
 * @param {import('./expression.js').ParsingContext} parsingContext The parsing context.
 * @param {CompilationContext} context The compilation context.
 * @return {Compiled} The compiled color.
 */
export function colorToJs(encoded, parsingContext, context) {
  return compileColor(parse(encoded, ColorType, parsingContext), context);
}
