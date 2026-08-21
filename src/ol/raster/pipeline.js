/**
 * @module ol/raster/pipeline
 */
import {buildExpression, newRasterEvaluationContext} from '../expr/cpu.js';
import {ColorType, newParsingContext, NumberType} from '../expr/expression.js';

/**
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
 * @param {number} value The value.
 * @return {number} The value clamped to the 0 to 1 range.
 */
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Read the color a pixel has before any style is applied.  Bands map onto channels the
 * way {@link module:ol/webgl/TileTexture} maps them onto texture formats, so an
 * adjustment-only style sees what the WebGL renderer sees.
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
 * Apply the style to every pixel of a tile.
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
        // The WebGL renderer discards the fragment; here that is a transparent pixel.
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

/**
 * Description of a tile to message between worker and main thread.  The style is included, so any
 * worker in the pool can serve any tile.
 *
 * @typedef {Object} Job
 * @property {string|number} styleId Identifies the style, so it is only compiled again
 * when it actually changed.
 * @property {import('../style/raster.js').RasterStyle} style The style.
 * @property {number} bandCount The number of bands per pixel.
 * @property {number} [nodataBandIndex] The 1-based index of the nodata band, if there is one.
 * @property {Uint8Array|Uint8ClampedArray|Float32Array} data The tile data.
 * @property {import('../size.js').Size} size The pixel size of the data.
 * @property {Object<string, *>} [variables] The style variables.
 */

/**
 * @typedef {Object} JobReply
 * @property {ImageBitmap} [bitmap] The rendered pixels.
 * @property {import('../size.js').Size} [size] The pixel size of the bitmap.
 * @property {string} [error] Why the job failed.
 */

/**
 * Make a function that turns a job into a reply.  Used by both the worker and the main thread.
 *
 * The handler holds on to the pipeline it last compiled, because a style changes rarely
 * while jobs keep coming.  Each handler has its own, so nothing is shared across workers.
 *
 * @return {function(Job): Promise<JobReply>} The job handler.
 */
export function createJobHandler() {
  /** @type {Pipeline|null} */
  let pipeline = null;

  /** @type {string|number|null} */
  let pipelineId = null;

  return async function (job) {
    try {
      if (pipelineId !== job.styleId || !pipeline) {
        pipeline = compileStyle(job.style, job.bandCount, job.nodataBandIndex);
        pipelineId = job.styleId;
      }

      const context = newRasterEvaluationContext();
      context.variables = job.variables || {};
      context.data = job.data;
      context.size = job.size;
      context.bandCount = job.bandCount;
      context.bandScale = job.data instanceof Float32Array ? 1 : 1 / 255;

      const rgba = render(pipeline, context);
      const size = job.size;

      const bitmap = await createImageBitmap(
        new ImageData(
          /** @type {Uint8ClampedArray<ArrayBuffer>} */ (rgba),
          size[0],
          size[1],
        ),
      );
      return {bitmap: bitmap, size: size};
    } catch (error) {
      pipeline = null;
      pipelineId = null;
      return {error: /** @type {Error} */ (error).message};
    }
  };
}
