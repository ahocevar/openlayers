import {assert} from 'chai';
import {describe, it} from 'vitest';
import {
  buildExpression,
  newEvaluationContext,
} from '../../../../src/ol/expr/cpu.js';
import {
  ColorType,
  newParsingContext,
} from '../../../../src/ol/expr/expression.js';
import {
  colorToJs,
  HCL_HELPERS,
  newCompilationContext,
  numberToJs,
} from '../../../../src/ol/expr/js.js';

/**
 * @typedef {Object} Options
 * @property {Float32Array|Uint8Array} [data] The tile data.
 * @property {import('../../../../src/ol/size.js').Size} [size] The pixel size of the data.
 * @property {number} [bandCount] The number of bands per pixel.
 * @property {number} [bandScale] Multiplier applied to raw band values.
 * @property {number} [col] The column of the pixel to evaluate at.
 * @property {number} [row] The row of the pixel to evaluate at.
 * @property {Object<string, *>} [variables] The style variables.
 * @property {number} [resolution] The view resolution.
 */

/**
 * @typedef {function(import('../../../../src/ol/expr/expression.js').EncodedExpression, import('../../../../src/ol/expr/expression.js').ParsingContext, import('../../../../src/ol/expr/js.js').CompilationContext): import('../../../../src/ol/expr/js.js').Compiled} Compiler
 */

/**
 * Turn a compiled expression into something callable, by declaring around it the identifiers
 * the render loop in {@link module:ol/raster/pipeline} declares: the tile data and where in it
 * the pixel is, the style variables, and the view resolution.  The channels come back as an
 * array, so a color reports four values and a number one.
 *
 * @param {Compiler} compile The compiler under test.
 * @param {import('../../../../src/ol/expr/expression.js').EncodedExpression} encoded The expression.
 * @param {number} [bandCount] The number of bands per pixel.
 * @return {{call: function(Options):Array<number>, context: import('../../../../src/ol/expr/js.js').CompilationContext, source: string}} The callable, the compilation context and the source.
 */
function compileToFunction(compile, encoded, bandCount) {
  const context = newCompilationContext();
  const compiled = compile(encoded, newParsingContext(), context);
  const source = `${context.needsHcl ? HCL_HELPERS : ''}
return function (data, size, bandScale, vars, resolution, col, row) {
  const width = size[0];
  const height = size[1];
  const bandCount = ${bandCount === undefined ? 1 : bandCount};
  const offset = (row * width + col) * bandCount;
${context.constants.join('\n')}
${compiled.statements.join('\n')}
  return [${compiled.value.join(', ')}];
};`;
  const fn = new Function(source)();

  /**
   * @param {Options} [options] The evaluation context.
   * @return {Array<number>} One value per channel.
   */
  function call(options) {
    const o = options || {};
    return fn(
      o.data || new Float32Array(1),
      o.size || [1, 1],
      o.bandScale === undefined ? 1 : o.bandScale,
      o.variables || {},
      o.resolution === undefined ? NaN : o.resolution,
      o.col === undefined ? 0 : o.col,
      o.row === undefined ? 0 : o.row,
    );
  }

  return {call: call, context: context, source: source};
}

/**
 * @param {import('../../../../src/ol/expr/expression.js').EncodedExpression} encoded The expression.
 * @param {Options} [options] The evaluation context.
 * @return {number} The value.
 */
function number(encoded, options) {
  return compileToFunction(
    numberToJs,
    encoded,
    options && options.bandCount,
  ).call(options)[0];
}

/**
 * @param {import('../../../../src/ol/expr/expression.js').EncodedExpression} encoded The expression.
 * @param {Options} [options] The evaluation context.
 * @return {Array<number>} Red, green and blue in the 0 to 255 range, and alpha in 0 to 1.
 */
function color(encoded, options) {
  return compileToFunction(
    colorToJs,
    encoded,
    options && options.bandCount,
  ).call(options);
}

/**
 * Style variables are read as plain property accesses, so a getter counts how often the
 * expression holding it was evaluated.  Evaluating a branch that should have been skipped
 * shows up here and nowhere else: it produces the same value, only more slowly.
 *
 * @param {Object<string, *>} values The variable values.
 * @return {{variables: Object<string, *>, reads: Object<string, number>}} The variables and
 * the read counts.
 */
function countingVariables(values) {
  /** @type {Object<string, number>} */
  const reads = {};
  /** @type {Object<string, *>} */
  const variables = {};
  for (const key of Object.keys(values)) {
    reads[key] = 0;
    Object.defineProperty(variables, key, {
      get() {
        ++reads[key];
        return values[key];
      },
      enumerable: true,
    });
  }
  return {variables: variables, reads: reads};
}

describe('ol/expr/js.js', () => {
  describe('numberToJs()', () => {
    it('reads a band, scaling raw values', () => {
      const data = new Float32Array([10, 20, 30, 40]);
      const options = {data: data, size: [2, 1], bandCount: 2};
      assert.strictEqual(number(['band', 1], options), 10);
      assert.strictEqual(number(['band', 2], options), 20);
      assert.strictEqual(
        number(['band', 1], {...options, col: 1}),
        30,
        'the second pixel',
      );
      assert.strictEqual(
        number(['band', 2], {...options, bandScale: 1 / 255}),
        20 / 255,
        'integer data is normalized',
      );
    });

    it('reads a neighbouring pixel at an offset', () => {
      const options = {
        data: new Float32Array([1, 2, 3]),
        size: [3, 1],
        col: 1,
      };
      assert.strictEqual(number(['band', 1, -1, 0], options), 1);
      assert.strictEqual(number(['band', 1, 1, 0], options), 3);
    });

    it('clamps offsets to the edges of the tile', () => {
      const across = {data: new Float32Array([1, 2, 3]), size: [3, 1]};
      assert.strictEqual(number(['band', 1, -1, 0], {...across, col: 0}), 1);
      assert.strictEqual(number(['band', 1, 1, 0], {...across, col: 2}), 3);

      const down = {data: new Float32Array([1, 2, 3]), size: [1, 3]};
      assert.strictEqual(number(['band', 1, 0, -1], {...down, row: 0}), 1);
      assert.strictEqual(number(['band', 1, 0, 1], {...down, row: 2}), 3);
      assert.strictEqual(number(['band', 1, 0, -1], {...down, row: 1}), 1);
    });

    it('reads a variable and the resolution', () => {
      assert.strictEqual(number(['var', 'v'], {variables: {v: 42}}), 42);
      assert.strictEqual(number(['resolution'], {resolution: 7}), 7);
    });

    it('folds the arithmetic operators', () => {
      assert.strictEqual(number(['+', 1, 2, 3]), 6);
      assert.strictEqual(number(['-', 10, 4]), 6);
      assert.strictEqual(number(['*', 2, 3, 4]), 24);
      assert.strictEqual(number(['/', 10, 4]), 2.5);
      assert.strictEqual(number(['%', 10, 3]), 1);
    });

    it('calls through to the Math functions', () => {
      assert.strictEqual(number(['abs', -3]), 3);
      assert.strictEqual(number(['floor', 1.7]), 1);
      assert.strictEqual(number(['ceil', 1.2]), 2);
      assert.strictEqual(number(['round', 1.5]), 2);
      assert.strictEqual(number(['sqrt', 9]), 3);
      assert.strictEqual(number(['^', 2, 10]), 1024);
      assert.strictEqual(number(['sin', 0]), 0);
      assert.strictEqual(number(['cos', 0]), 1);
      assert.strictEqual(number(['atan', 1]), Math.atan(1));
      assert.strictEqual(number(['atan', 1, 2]), Math.atan2(1, 2));
      assert.strictEqual(number(['clamp', 5, 0, 1]), 1);
      assert.strictEqual(number(['clamp', -5, 0, 1]), 0);
    });

    it('interpolates linearly between stops', () => {
      const ramp = ['interpolate', ['linear'], ['var', 'v'], 0, 0, 10, 100];
      assert.strictEqual(number(ramp, {variables: {v: 5}}), 50);
      assert.strictEqual(number(ramp, {variables: {v: -1}}), 0, 'below');
      assert.strictEqual(number(ramp, {variables: {v: 11}}), 100, 'above');
    });

    it('interpolates exponentially between stops', () => {
      const ramp = [
        'interpolate',
        ['exponential', 2],
        ['var', 'v'],
        0,
        0,
        1,
        100,
      ];
      assert.approximately(
        number(ramp, {variables: {v: 0.5}}),
        (100 * (Math.sqrt(2) - 1)) / (2 - 1),
        1e-9,
      );
    });

    it('takes the first case whose test passes', () => {
      const expression = [
        'case',
        ['>', ['var', 'v'], 10],
        1,
        ['>', ['var', 'v'], 5],
        2,
        3,
      ];
      assert.strictEqual(number(expression, {variables: {v: 11}}), 1);
      assert.strictEqual(number(expression, {variables: {v: 6}}), 2);
      assert.strictEqual(number(expression, {variables: {v: 0}}), 3);
    });

    it('tests a boolean variable as it is', () => {
      // a shader gets a float uniform and has to compare it; here the variable is a boolean
      const expression = ['case', ['var', 'on'], 1, 2];
      assert.strictEqual(number(expression, {variables: {on: true}}), 1);
      assert.strictEqual(number(expression, {variables: {on: false}}), 2);
    });

    it('matches a value against the cases', () => {
      const expression = ['match', ['var', 'v'], 1, 10, 2, 20, 30];
      assert.strictEqual(number(expression, {variables: {v: 1}}), 10);
      assert.strictEqual(number(expression, {variables: {v: 2}}), 20);
      assert.strictEqual(number(expression, {variables: {v: 3}}), 30);
    });

    it('combines booleans with all, any, not and between', () => {
      const expression = [
        'case',
        [
          'all',
          ['between', ['var', 'v'], 5, 10],
          ['!', ['==', ['var', 'v'], 7]],
        ],
        1,
        ['any', ['<', ['var', 'v'], 0], ['>=', ['var', 'v'], 100]],
        2,
        3,
      ];
      assert.strictEqual(number(expression, {variables: {v: 6}}), 1);
      assert.strictEqual(number(expression, {variables: {v: 7}}), 3);
      assert.strictEqual(number(expression, {variables: {v: -1}}), 2);
      assert.strictEqual(number(expression, {variables: {v: 100}}), 2);
    });

    it('tests membership with in', () => {
      const numbers = ['case', ['in', ['var', 'v'], [1, 3]], 1, 0];
      assert.strictEqual(number(numbers, {variables: {v: 3}}), 1);
      assert.strictEqual(number(numbers, {variables: {v: 2}}), 0);

      const strings = [
        'case',
        ['in', ['var', 'v'], ['literal', ['a', 'b']]],
        1,
        0,
      ];
      assert.strictEqual(number(strings, {variables: {v: 'b'}}), 1);
      assert.strictEqual(number(strings, {variables: {v: 'c'}}), 0);
    });

    it('answers with the first argument an assertion accepts', () => {
      assert.strictEqual(
        number(['number', ['var', 'a'], ['var', 'b']], {
          variables: {a: 'not a number', b: 5},
        }),
        5,
      );
      assert.strictEqual(
        number(['coalesce', ['var', 'a'], ['var', 'b']], {
          variables: {a: null, b: 5},
        }),
        5,
      );
    });

    it('throws when no argument satisfies an assertion', () => {
      assert.throws(
        () => number(['number', ['var', 'a']], {variables: {a: 'nope'}}),
        /Expected one of the values to be a number/,
      );
      assert.throws(
        () =>
          number(['coalesce', ['var', 'a'], ['var', 'b']], {
            variables: {a: null, b: null},
          }),
        /Expected one of the values to be non-null/,
      );
    });

    it('rejects the operators that read feature data', () => {
      for (const encoded of [
        ['get', 'x'],
        ['has', 'x'],
        ['id'],
        ['geometry-type'],
        ['line-metric'],
      ]) {
        assert.throws(
          () => number(['case', ['==', encoded, 1], 1, 0]),
          /reads feature data, which a raster style has none of/,
          String(encoded[0]),
        );
      }
    });

    it('rejects the operators that build a string', () => {
      for (const encoded of [
        ['concat', ['var', 'a'], 'b'],
        ['to-string', ['var', 'a']],
      ]) {
        assert.throws(
          () => number(['case', ['==', encoded, 'ab'], 1, 0]),
          /builds a string, which a raster style has no use for/,
        );
      }
    });
  });

  describe('colorToJs()', () => {
    it('compiles a literal color', () => {
      assert.deepEqual(color([255, 128, 0]), [255, 128, 0, 1]);
      assert.deepEqual(color([255, 128, 0, 0.5]), [255, 128, 0, 0.5]);
      assert.deepEqual(color('#ff8000'), [255, 128, 0, 1]);
    });

    it('assembles a color from numbers', () => {
      assert.deepEqual(color(['color', 128]), [128, 128, 128, 1]);
      assert.deepEqual(color(['color', 128, 0.5]), [128, 128, 128, 0.5]);
      assert.deepEqual(color(['color', 1, 2, 3]), [1, 2, 3, 1]);
      assert.deepEqual(color(['color', 1, 2, 3, 0.5]), [1, 2, 3, 0.5]);
    });

    it('scales an array used as a color, the way a shader reads a vec4', () => {
      assert.deepEqual(
        color(['array', 1, 0, 0.5, 0.25]),
        [255, 0, 127.5, 0.25],
      );
      assert.deepEqual(color(['array', 1, 0, 0.5]), [255, 0, 127.5, 1]);
    });

    it('reads a color variable as an rgba array', () => {
      assert.deepEqual(
        color(['var', 'tint'], {variables: {tint: [255, 128, 0, 0.5]}}),
        [255, 128, 0, 0.5],
      );
      assert.deepEqual(
        color(['var', 'tint'], {variables: {tint: [255, 128, 0]}}),
        [255, 128, 0, 1],
        'an array written without an alpha is opaque',
      );
    });

    it('looks a color up in a palette, clamping the index', () => {
      const palette = ['palette', ['var', 'i'], ['#000000', '#ffffff']];
      assert.deepEqual(color(palette, {variables: {i: 0}}), [0, 0, 0, 1]);
      assert.deepEqual(color(palette, {variables: {i: 1}}), [255, 255, 255, 1]);
      assert.deepEqual(
        color(palette, {variables: {i: 1.9}}),
        [255, 255, 255, 1],
        'the index is floored',
      );
      assert.deepEqual(
        color(palette, {variables: {i: 9}}),
        [255, 255, 255, 1],
        'above the last entry',
      );
      assert.deepEqual(
        color(palette, {variables: {i: -4}}),
        [0, 0, 0, 1],
        'below the first entry',
      );
    });

    it('interpolates between color stops', () => {
      const ramp = [
        'interpolate',
        ['linear'],
        ['var', 'v'],
        0,
        [0, 0, 0, 0],
        1,
        [255, 128, 64, 1],
      ];
      assert.deepEqual(
        color(ramp, {variables: {v: 0.5}}),
        [127.5, 64, 32, 0.5],
      );
      assert.deepEqual(color(ramp, {variables: {v: 0}}), [0, 0, 0, 0]);
      assert.deepEqual(color(ramp, {variables: {v: 1}}), [255, 128, 64, 1]);
    });

    it('interpolates in HCL the way ol/expr/cpu does', () => {
      // the emitted `mixHcl` is a transcription of the color conversions in ol/color, so it
      // has to answer exactly what the library's own interpolation answers
      const ramp = [
        'interpolate-hcl',
        ['linear'],
        ['var', 'v'],
        0,
        [255, 0, 0, 1],
        0.5,
        [0, 255, 0, 0.5],
        1,
        [0, 0, 255, 1],
      ];
      const evaluate = buildExpression(ramp, ColorType, newParsingContext());
      const context = newEvaluationContext();
      for (const v of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        context.variables = {v: v};
        assert.deepEqual(
          color(ramp, {variables: {v: v}}),
          Array.from(/** @type {Array<number>} */ (evaluate(context))),
          `at ${v}`,
        );
      }
    });

    it('takes the branch a case or match selects', () => {
      const cases = [
        'case',
        ['>', ['var', 'v'], 0],
        [1, 2, 3, 1],
        [4, 5, 6, 1],
      ];
      assert.deepEqual(color(cases, {variables: {v: 1}}), [1, 2, 3, 1]);
      assert.deepEqual(color(cases, {variables: {v: 0}}), [4, 5, 6, 1]);

      const matches = ['match', ['var', 'v'], 'a', [1, 2, 3, 1], [4, 5, 6, 1]];
      assert.deepEqual(color(matches, {variables: {v: 'a'}}), [1, 2, 3, 1]);
      assert.deepEqual(color(matches, {variables: {v: 'z'}}), [4, 5, 6, 1]);
    });

    it('rejects an assertion over colors', () => {
      assert.throws(
        () => color(['coalesce', [1, 2, 3, 1], [4, 5, 6, 1]]),
        /'coalesce' operator cannot be used with colors/,
      );
    });
  });

  describe('branch laziness', () => {
    it('evaluates only the case arm that is taken', () => {
      const {variables, reads} = countingVariables({v: 1, taken: 2, other: 3});
      const {call} = compileToFunction(colorToJs, [
        'case',
        ['>', ['var', 'v'], 0],
        ['array', ['var', 'taken'], 0, 0, 1],
        ['array', ['var', 'other'], 0, 0, 1],
      ]);
      call({variables: variables});
      assert.deepEqual(reads, {v: 1, taken: 1, other: 0});
    });

    it('evaluates only the arm a match selects', () => {
      const {variables, reads} = countingVariables({
        v: 1,
        hit: 2,
        miss: 3,
        fallback: 4,
      });
      const {call} = compileToFunction(colorToJs, [
        'match',
        ['var', 'v'],
        1,
        ['array', ['var', 'hit'], 0, 0, 1],
        2,
        ['array', ['var', 'miss'], 0, 0, 1],
        ['array', ['var', 'fallback'], 0, 0, 1],
      ]);
      call({variables: variables});
      assert.deepEqual(reads, {v: 1, hit: 1, miss: 0, fallback: 0});
    });

    it('evaluates only the two stops of the interpolate segment taken', () => {
      const {variables, reads} = countingVariables({
        v: 500,
        first: 1,
        second: 2,
        third: 3,
      });
      const {call} = compileToFunction(colorToJs, [
        'interpolate',
        ['linear'],
        ['var', 'v'],
        0,
        ['array', ['var', 'first'], 0, 0, 1],
        1000,
        ['array', ['var', 'second'], 0, 0, 1],
        3000,
        ['array', ['var', 'third'], 0, 0, 1],
      ]);
      call({variables: variables});
      assert.deepEqual(reads, {v: 1, first: 1, second: 1, third: 0});
    });

    it('evaluates no more arguments than an assertion needs', () => {
      const {variables, reads} = countingVariables({first: 1, second: 2});
      const {call} = compileToFunction(numberToJs, [
        'number',
        ['var', 'first'],
        ['var', 'second'],
      ]);
      call({variables: variables});
      assert.deepEqual(reads, {first: 1, second: 0});
    });

    it('evaluates a value tested against several stops only once', () => {
      const {variables, reads} = countingVariables({v: 2500});
      const {call} = compileToFunction(numberToJs, [
        'interpolate',
        ['linear'],
        ['var', 'v'],
        0,
        0,
        1000,
        1,
        3000,
        2,
      ]);
      call({variables: variables});
      assert.deepEqual(reads, {v: 1});
    });
  });

  describe('newCompilationContext()', () => {
    it('reports a band offset as needing the pixel position', () => {
      assert.isFalse(
        compileToFunction(numberToJs, ['band', 1]).context.needsPosition,
      );
      assert.isTrue(
        compileToFunction(numberToJs, ['band', 1, 1, 0]).context.needsPosition,
      );
    });

    it('reports interpolate-hcl as needing the HCL helpers', () => {
      const stops = [['var', 'v'], 0, [255, 0, 0, 1], 1, [0, 0, 255, 1]];
      assert.isFalse(
        compileToFunction(colorToJs, ['interpolate', ['linear'], ...stops])
          .context.needsHcl,
      );
      assert.isTrue(
        compileToFunction(colorToJs, ['interpolate-hcl', ['linear'], ...stops])
          .context.needsHcl,
      );
    });

    it('numbers temporaries so a second compilation does not collide', () => {
      const context = newCompilationContext();
      const parsingContext = newParsingContext();
      const first = numberToJs(
        ['number', ['var', 'a']],
        parsingContext,
        context,
      );
      const second = numberToJs(
        ['number', ['var', 'b']],
        parsingContext,
        context,
      );
      assert.notDeepEqual(first.value, second.value);
    });
  });
});
