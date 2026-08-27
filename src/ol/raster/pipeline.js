/**
 * @module ol/raster/pipeline
 */
import {buildExpression} from '../expr/cpu.js';
import {ColorType, newParsingContext, NumberType} from '../expr/expression.js';
import {
  colorToJs,
  HCL_HELPERS,
  newCompilationContext,
  numberToJs,
} from '../expr/js.js';

/**
 * A style compiled to a tree of closures, walked once per pixel by {@link render}.  This is
 * what {@link module:ol/raster/fallback} runs where a content security policy refuses the
 * generated worker; everywhere else the emitted loop from {@link compileStyleToSource} runs
 * instead, and the two are held to producing the same pixels.
 *
 * @typedef {Object} Pipeline
 * @property {import('../expr/cpu.js').ExpressionEvaluator|null} color The color expression.
 * @property {import('../expr/cpu.js').NumberEvaluator|null} contrast Contrast adjustment.
 * @property {import('../expr/cpu.js').NumberEvaluator|null} exposure Exposure adjustment.
 * @property {import('../expr/cpu.js').NumberEvaluator|null} saturation Saturation adjustment.
 * @property {import('../expr/cpu.js').NumberEvaluator|null} gamma Gamma adjustment.
 * @property {import('../expr/cpu.js').NumberEvaluator|null} brightness Brightness adjustment.
 * @property {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @property {number} bandCount The band count the style was compiled for.
 */

/**
 * Compile a style to closures, for {@link render} to walk.
 *
 * @param {import('../style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @param {import('../expr/expression.js').ParsingContext} [context] Parsing context, to
 * read what the style refers to.  One context serves the whole style, so a variable used
 * with two different types is caught.
 * @return {Pipeline} The compiled pipeline.
 */
export function compileStyle(style, bandCount, nodataBandIndex, context) {
  const parsingContext = context || newParsingContext();

  /**
   * @param {import('../expr/expression.js').EncodedExpression|undefined} encoded The expression.
   * @return {import('../expr/cpu.js').NumberEvaluator|null} The evaluator.
   */
  function number(encoded) {
    if (encoded === undefined) {
      return null;
    }
    return /** @type {import('../expr/cpu.js').NumberEvaluator} */ (
      buildExpression(encoded, NumberType, parsingContext)
    );
  }

  return {
    color:
      style.color === undefined
        ? null
        : buildExpression(style.color, ColorType, parsingContext),
    contrast: number(style.contrast),
    exposure: number(style.exposure),
    saturation: number(style.saturation),
    gamma: number(style.gamma),
    brightness: number(style.brightness),
    nodataBandIndex: nodataBandIndex,
    bandCount: bandCount,
  };
}

/**
 * The color a pixel has before any style is applied, as the four channel expressions the
 * emitted loop expects: red, green and blue in the 0 to 255 range and alpha in 0 to 1.  This is
 * the compiled counterpart of {@link readBandColor}, and maps bands onto channels the same way:
 * the way {@link module:ol/webgl/TileTexture} maps them onto texture formats, so a style that
 * only adjusts the colors sees what the WebGL renderer sees.
 *
 * @param {number} bandCount The number of bands per pixel.
 * @param {number} nodataOffset The 0-based nodata band index, or -1 for none.
 * @return {import('../expr/js.js').Compiled} The compiled color.
 */
function bandColor(bandCount, nodataOffset) {
  /**
   * @param {number} index The 0-based band index.
   * @return {string} The band value, in the 0 to 1 range.
   */
  function band(index) {
    return `data[offset + ${index}] * bandScale`;
  }

  /** @type {Array<string>} */
  let value;
  /** @type {Array<string>} */
  let statements = [];
  if (bandCount < 3) {
    // one band is a gray value, and a second band is its alpha
    statements = [`const gray = ${band(0)} * 255;`];
    value = ['gray', 'gray', 'gray', bandCount === 2 ? band(1) : '1'];
  } else {
    value = [
      `(${band(0)} * 255)`,
      `(${band(1)} * 255)`,
      `(${band(2)} * 255)`,
      bandCount > 3 ? band(3) : '1',
    ];
  }

  if (nodataOffset >= 0) {
    value[3] = band(nodataOffset);
  }
  return {statements: statements, value: value};
}

/**
 * Assemble the source of a specialised render function for a style, instead of walking a tree
 * of closures once per pixel.  Throws when the style uses an operator
 * {@link module:ol/expr/js} cannot emit — which for a raster style means one that reads
 * feature data or builds a string, neither of which a raster style has a source for.
 * {@link module:ol/raster/style~validateStyle} compiles a style when it is set, so this
 * throws where the style was written rather than on a worker.
 *
 * The source is a function expression taking the tile data, its size, the band scale, the style
 * variables, the resolution and an optional array to write into, and answering the rendered
 * pixels — the same pixels {@link render} makes from the same style.  Variables are read on
 * every call, so changing them needs no recompilation.  Returning source rather than a function
 * is what lets a worker be built from it without `eval`.
 *
 * @param {import('../style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @param {import('../expr/expression.js').ParsingContext} [context] Parsing context, to read
 * what the style refers to.  One context serves the whole style, so a variable used with two
 * different types is caught.
 * @return {string} The function source.
 */
export function compileStyleToSource(
  style,
  bandCount,
  nodataBandIndex,
  context,
) {
  const parsingContext = context || newParsingContext();
  const prelude = newCompilationContext();
  /** @type {Array<string>} */
  const preludeStatements = [];

  /**
   * @param {import('../expr/expression.js').EncodedExpression|undefined} encoded The expression.
   * @param {string} fallback The source used when the style omits it.
   * @return {string} The source for the adjustment.
   */
  function adjustment(encoded, fallback) {
    if (encoded === undefined) {
      return fallback;
    }
    const compiled = numberToJs(encoded, parsingContext, prelude);
    preludeStatements.push(...compiled.statements);
    return compiled.value[0];
  }

  // the adjustments do not vary per pixel, so they are evaluated once for the whole tile
  const contrast = adjustment(style.contrast, '0');
  const exposure = adjustment(style.exposure, '0');
  const saturation = adjustment(style.saturation, '0');
  const gamma = adjustment(style.gamma, '1');
  const brightness = adjustment(style.brightness, '0');

  const loop = newCompilationContext();
  // continue the numbering, so a loop temporary never shadows a prelude one
  loop.counter = prelude.counter;

  const nodataOffset = nodataBandIndex === undefined ? -1 : nodataBandIndex - 1;

  const compiledColor =
    style.color === undefined
      ? bandColor(bandCount, nodataOffset)
      : colorToJs(style.color, parsingContext, loop);
  const color = compiledColor.value;

  let source = `function (data, size, bandScale, vars, resolution, out) {
  const width = size[0];
  const height = size[1];
  const count = width * height;
  // the caller may hand in an array to write into, so that styling a tile again does not
  // allocate a new one.  Every pixel is written, nodata included, so nothing stale shows.
  const rgba = out || new Uint8ClampedArray(count * 4);
  const bandCount = ${bandCount};
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

${[...prelude.constants, ...loop.constants]
  .map((/** @type {string} */ line) => '  ' + line)
  .join('\n')}
${preludeStatements.map((/** @type {string} */ line) => '  ' + line).join('\n')}
  const contrast = ${contrast};
  const exposure = ${exposure};
  const saturation = ${saturation} + 1;
  const gamma = ${gamma};
  const brightness = ${brightness};
  const power = 1 / gamma;
  const sr = (1 - saturation) * 0.2126;
  const sg = (1 - saturation) * 0.7152;
  const sb = (1 - saturation) * 0.0722;

  for (let i = 0, offset = 0, target = 0; i < count; ++i, offset += bandCount, target += 4) {
${
  loop.needsPosition
    ? `    const row = (i / width) | 0;
    const col = i - row * width;`
    : ''
}
${
  nodataOffset < 0
    ? ''
    : `    if (data[offset + ${nodataOffset}] === 0) {
      // the WebGL renderer discards the fragment; here that is a transparent pixel
      rgba[target] = 0;
      rgba[target + 1] = 0;
      rgba[target + 2] = 0;
      rgba[target + 3] = 0;
      continue;
    }`
}
${compiledColor.statements.map((/** @type {string} */ line) => '    ' + line).join('\n')}
    let r = ${color[0]} / 255;
    let g = ${color[1]} / 255;
    let b = ${color[2]} / 255;
${
  style.contrast === undefined
    ? ''
    : `    r = clamp01((contrast + 1) * r - contrast / 2);
    g = clamp01((contrast + 1) * g - contrast / 2);
    b = clamp01((contrast + 1) * b - contrast / 2);`
}
${
  style.exposure === undefined
    ? ''
    : `    r = clamp01((exposure + 1) * r);
    g = clamp01((exposure + 1) * g);
    b = clamp01((exposure + 1) * b);`
}
${
  style.saturation === undefined
    ? ''
    : `    const sat0 = clamp01((sr + saturation) * r + sg * g + sb * b);
    const sat1 = clamp01(sr * r + (sg + saturation) * g + sb * b);
    const sat2 = clamp01(sr * r + sg * g + (sb + saturation) * b);
    r = sat0;
    g = sat1;
    b = sat2;`
}
${
  style.gamma === undefined
    ? ''
    : `    r = Math.pow(r, power);
    g = Math.pow(g, power);
    b = Math.pow(b, power);`
}
${
  style.brightness === undefined
    ? ''
    : `    r = clamp01(r + brightness);
    g = clamp01(g + brightness);
    b = clamp01(b + brightness);`
}
    rgba[target] = r * 255;
    rgba[target + 1] = g * 255;
    rgba[target + 2] = b * 255;
    rgba[target + 3] = (${color[3]}) * 255;
  }
  return rgba;
}`;

  if (loop.needsHcl) {
    // the helpers are shared by every pixel and every call, so they are built once by a
    // wrapper rather than declared inside the render function
    source = `(function () {\n${HCL_HELPERS}\nreturn ${source};\n})()`;
  }

  return source;
}

/**
 * {@link compileStyleToSource} as a callable function, for tests.  The renderer never uses
 * this: `new Function` needs `script-src 'unsafe-eval'`, which is exactly what building the
 * worker from source avoids.
 *
 * @param {import('../style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @return {function(Uint8Array|Uint8ClampedArray|Float32Array, import('../size.js').Size, number, Object<string, *>, number=, Uint8ClampedArray=): Uint8ClampedArray} The render function.
 */
export function compileStyleToFunction(style, bandCount, nodataBandIndex) {
  const source = compileStyleToSource(style, bandCount, nodataBandIndex);
  return new Function(`return ${source};`)();
}

/**
 * @param {number} value The value.
 * @return {number} The value clamped to the 0 to 1 range.
 */
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Read the color a pixel has before any style is applied.  The closure counterpart of
 * {@link bandColor}.
 *
 * @param {import('../expr/cpu.js').EvaluationContext} context The evaluation context.
 * @param {Array<number>} rgba Receives the color, with all four channels in the 0 to 1 range.
 */
function readBandColor(context, rgba) {
  const data = /** @type {Uint8Array|Uint8ClampedArray|Float32Array} */ (
    context.data
  );
  const bandCount = /** @type {number} */ (context.bandCount);
  const scale = /** @type {number} */ (context.bandScale);
  const width = /** @type {import('../size.js').Size} */ (context.size)[0];
  const row = /** @type {number} */ (context.row);
  const col = /** @type {number} */ (context.col);
  const offset = (row * width + col) * bandCount;

  switch (bandCount) {
    case 1: {
      const value = data[offset] * scale;
      rgba[0] = value;
      rgba[1] = value;
      rgba[2] = value;
      rgba[3] = 1;
      break;
    }
    case 2: {
      const value = data[offset] * scale;
      rgba[0] = value;
      rgba[1] = value;
      rgba[2] = value;
      rgba[3] = data[offset + 1] * scale;
      break;
    }
    case 3: {
      rgba[0] = data[offset] * scale;
      rgba[1] = data[offset + 1] * scale;
      rgba[2] = data[offset + 2] * scale;
      rgba[3] = 1;
      break;
    }
    default: {
      rgba[0] = data[offset] * scale;
      rgba[1] = data[offset + 1] * scale;
      rgba[2] = data[offset + 2] * scale;
      rgba[3] = data[offset + 3] * scale;
      break;
    }
  }
}

/**
 * Apply the style to every pixel of a tile, walking the closure tree once per pixel.  Around
 * twenty times slower than the loop {@link compileStyleToSource} emits, which is why it only
 * runs where that loop cannot be reached — see {@link module:ol/raster/fallback}.
 *
 * @param {Pipeline} style The compiled pipeline.
 * @param {import('../expr/cpu.js').EvaluationContext} context The evaluation context.
 * @return {Uint8ClampedArray} The rendered pixels.
 */
export function render(style, context) {
  const size = /** @type {import('../size.js').Size} */ (context.size);
  const width = size[0];
  const height = size[1];
  const rgba = new Uint8ClampedArray(width * height * 4);

  // The adjustments do not vary per pixel, even when they read a style variable, so
  // evaluate them once for the whole tile.
  const contrast = style.contrast ? style.contrast(context) : 0;
  const exposure = style.exposure ? style.exposure(context) : 0;
  const saturation = style.saturation ? style.saturation(context) + 1 : 1;
  const gamma = style.gamma ? style.gamma(context) : 1;
  const brightness = style.brightness ? style.brightness(context) : 0;

  const sr = (1 - saturation) * 0.2126;
  const sg = (1 - saturation) * 0.7152;
  const sb = (1 - saturation) * 0.0722;

  const nodataBandIndex = style.nodataBandIndex;
  const nodataOffset = nodataBandIndex ? nodataBandIndex - 1 : 0;
  const bandCount = /** @type {number} */ (context.bandCount);
  const data = /** @type {Uint8Array|Uint8ClampedArray|Float32Array} */ (
    context.data
  );

  const color = [0, 0, 0, 1];
  let target = 0;
  for (let row = 0; row < height; ++row) {
    context.row = row;
    for (let col = 0; col < width; ++col, target += 4) {
      context.col = col;

      const nodata =
        nodataBandIndex !== undefined &&
        data[(row * width + col) * bandCount + nodataOffset] === 0;
      if (nodata) {
        // The WebGL renderer discards the fragment; here that is a transparent pixel, which
        // a freshly allocated array already holds.
        continue;
      }

      if (style.color) {
        const value = /** @type {Array<number>} */ (style.color(context));
        color[0] = value[0] / 255;
        color[1] = value[1] / 255;
        color[2] = value[2] / 255;
        color[3] = value[3];
      } else {
        readBandColor(context, color);
        if (nodataBandIndex !== undefined) {
          color[3] =
            data[(row * width + col) * bandCount + nodataOffset] *
            /** @type {number} */ (context.bandScale);
        }
      }

      let r = color[0];
      let g = color[1];
      let b = color[2];

      if (style.contrast) {
        r = clamp01((contrast + 1) * r - contrast / 2);
        g = clamp01((contrast + 1) * g - contrast / 2);
        b = clamp01((contrast + 1) * b - contrast / 2);
      }
      if (style.exposure) {
        r = clamp01((exposure + 1) * r);
        g = clamp01((exposure + 1) * g);
        b = clamp01((exposure + 1) * b);
      }
      if (style.saturation) {
        // The same matrix the shader builds, written out.
        const sat0 = clamp01((sr + saturation) * r + sg * g + sb * b);
        const sat1 = clamp01(sr * r + (sg + saturation) * g + sb * b);
        const sat2 = clamp01(sr * r + sg * g + (sb + saturation) * b);
        r = sat0;
        g = sat1;
        b = sat2;
      }
      if (style.gamma) {
        const power = 1 / gamma;
        r = Math.pow(r, power);
        g = Math.pow(g, power);
        b = Math.pow(b, power);
      }
      if (style.brightness) {
        r = clamp01(r + brightness);
        g = clamp01(g + brightness);
        b = clamp01(b + brightness);
      }

      rgba[target] = r * 255;
      rgba[target + 1] = g * 255;
      rgba[target + 2] = b * 255;
      rgba[target + 3] = color[3] * 255;
    }
  }
  return rgba;
}
