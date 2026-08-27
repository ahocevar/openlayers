/**
 * A worker that applies raster styles to tile data.
 * @module ol/worker/rasterStyle
 */
import {newRasterEvaluationContext} from '../expr/cpu.js';
import {compileStyle, render} from '../raster/pipeline.js';

/**
 * @typedef {Object} StyleJob
 * @property {string} styleId Identifies the style, so that it is only compiled once.
 * @property {import("../style/raster.js").RasterStyle} style The style to apply.
 * @property {Uint8Array|Uint8ClampedArray|Float32Array} data The tile data.
 * @property {import("../size.js").Size} size The pixel size of the data, gutter included.
 * @property {number} bandCount The number of bands per pixel.
 * @property {number} [nodataBandIndex] The 1-based nodata band index.
 * @property {Object<string, *>} [variables] The style variables.
 * @property {number} [resolution] The resolution to apply the style at.
 */

/** @type {any} */
const worker = self;

/**
 * @type {Object<string, import("../raster/pipeline.js").Pipeline>}
 */
const pipelines = {};

/**
 * One output array per pixel count, written into again rather than made anew for every
 * tile.  A worker runs one job at a time, and `createImageBitmap` has copied the pixels
 * by the time the next one arrives.
 * @type {Object<number, Uint8ClampedArray>}
 */
const outputs = {};

const context = newRasterEvaluationContext();

worker.onmessage = async (/** @type {MessageEvent} */ event) => {
  const job = /** @type {StyleJob} */ (event.data);
  try {
    const key = `${job.styleId}/${job.bandCount}/${job.nodataBandIndex ?? ''}`;
    let pipeline = pipelines[key];
    if (!pipeline) {
      pipeline = compileStyle(job.style, job.bandCount, job.nodataBandIndex);
      pipelines[key] = pipeline;
    }

    const length = job.size[0] * job.size[1] * 4;
    let output = outputs[length];
    if (!output) {
      output = new Uint8ClampedArray(length);
      outputs[length] = output;
    }

    context.data = job.data;
    context.size = job.size;
    context.bandCount = job.bandCount;
    // integer data is normalized to the 0 to 1 range; floating point data passes through
    context.bandScale = job.data instanceof Float32Array ? 1 : 1 / 255;
    context.variables = job.variables || {};
    context.resolution = job.resolution ?? NaN;

    const rgba = render(pipeline, context, output);
    const bitmap = await createImageBitmap(
      new ImageData(/** @type {*} */ (rgba), job.size[0], job.size[1]),
    );
    worker.postMessage({bitmap: bitmap, size: job.size}, [bitmap]);
  } catch (error) {
    worker.postMessage({error: /** @type {Error} */ (error).message});
  }
};

/** @type {function(): Worker} */ export let create;
