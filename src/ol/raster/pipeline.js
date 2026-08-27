/**
 * @module ol/raster/pipeline
 */
import {buildExpression} from '../expr/cpu.js';
import {ColorType, newParsingContext, NumberType} from '../expr/expression.js';

/**
 * A style compiled to a tree of closures, walked once per pixel by {@link render}.
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
 * Compile a style to closures, for {@link render} to walk.  Throws for a style using an
 * operator a raster style has no data for, such as one that reads feature properties.
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

  const pipeline = {
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

  if (parsingContext.properties.size || parsingContext.featureId) {
    throw new Error('Raster styles have no feature data to read');
  }

  return pipeline;
}

/**
 * @param {number} value The value.
 * @return {number} The value clamped to the 0 to 1 range.
 */
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Apply a compiled style to every pixel of a tile.
 *
 * @param {Pipeline} style The compiled pipeline.
 * @param {import('../expr/cpu.js').EvaluationContext} context The evaluation context.
 * @param {Uint8ClampedArray} [out] An array to write into, instead of a new one.
 * @return {Uint8ClampedArray} The rendered pixels.
 */
export function render(style, context, out) {
  const size = /** @type {import('../size.js').Size} */ (context.size);
  const width = size[0];
  const height = size[1];
  const rgba = out || new Uint8ClampedArray(width * height * 4);

  // the adjustments do not vary per pixel, even when they read a style variable
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
  const scale = /** @type {number} */ (context.bandScale);
  const data = /** @type {Uint8Array|Uint8ClampedArray|Float32Array} */ (
    context.data
  );

  // which band feeds each channel of a pixel no style gives a color: one band is a gray
  // value, a second is its alpha, and three or more are the channels
  const greenBand = bandCount < 3 ? 0 : 1;
  const blueBand = bandCount < 3 ? 0 : 2;
  const alphaBand =
    nodataBandIndex !== undefined
      ? nodataOffset
      : bandCount === 2
        ? 1
        : bandCount > 3
          ? 3
          : -1;

  const color = [0, 0, 0, 1];
  let target = 0;
  let offset = 0;
  for (let row = 0; row < height; ++row) {
    context.row = row;
    for (let col = 0; col < width; ++col, target += 4, offset += bandCount) {
      context.col = col;

      if (nodataBandIndex !== undefined && data[offset + nodataOffset] === 0) {
        rgba[target] = 0;
        rgba[target + 1] = 0;
        rgba[target + 2] = 0;
        rgba[target + 3] = 0;
        continue;
      }

      if (style.color) {
        const value = /** @type {Array<number>} */ (style.color(context));
        color[0] = value[0] / 255;
        color[1] = value[1] / 255;
        color[2] = value[2] / 255;
        color[3] = value[3];
      } else {
        color[0] = data[offset] * scale;
        color[1] = data[offset + greenBand] * scale;
        color[2] = data[offset + blueBand] * scale;
        color[3] = alphaBand < 0 ? 1 : data[offset + alphaBand] * scale;
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
