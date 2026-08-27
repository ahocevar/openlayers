/**
 * @module ol/raster/fallback
 */
import {newRasterEvaluationContext} from '../expr/cpu.js';
import {compileStyle, render} from './pipeline.js';

/**
 * @fileoverview A stand-in for the generated worker, for pages whose content security policy
 * refuses it.  Building a worker from a `blob:` url needs `worker-src blob:`, and there is no
 * hash or nonce that buys an exception; neither is there one for `new Function`, so a page
 * without `blob:` cannot run generated code at all.  What is left is walking the style as a
 * tree of closures, which is what {@link module:ol/raster/pipeline~render} does.
 *
 * It runs on the main thread on purpose.  A worker carrying the interpreter would have to be
 * built from a Blob as well — {@link module:ol/worker} ships every worker that way — so it
 * would be refused by the very policy this exists for.
 *
 * Expect it to be some twenty times slower than the generated worker, on top of sharing the
 * thread it renders on.  It is here so that a styled data tile layer draws the right pixels
 * rather than nothing at all, not to be a second way of styling tiles.
 */

/**
 * A job as {@link module:ol/raster/StyledTile} posts it.  The same shape the generated
 * worker's message handler reads, in {@link module:ol/raster/workerSource}.
 *
 * @typedef {Object} StyleJob
 * @property {string} styleId Names the style to apply.
 * @property {Uint8Array|Uint8ClampedArray|Float32Array} data The tile data.
 * @property {import('../size.js').Size} size The pixel size of the data.
 * @property {Object<string, *>} [variables] The style variables.
 * @property {number} [resolution] The resolution the style is applied at.
 */

/**
 * Create something that behaves like the generated worker, but interprets the styles on the
 * main thread.
 *
 * @param {Object<string, import('./processor.js').Handler>} handlers The registered handlers,
 * keyed by the ids the jobs name.
 * @return {import('../Processor.js').WorkerLike} The faux worker.
 */
export function createFallbackWorker(handlers) {
  // one context for every pixel of every tile, mutated in place, exactly as the closure tree
  // expects
  const context = newRasterEvaluationContext();
  /**
   * Compiled on first use rather than up front, so that a style the closure compiler cannot
   * build is reported as that job's error instead of throwing where the pool is made.
   * @type {Object<string, import('./pipeline.js').Pipeline>}
   */
  const pipelines = {};
  let terminated = false;

  /** @type {import('../Processor.js').WorkerLike} */
  const worker = {
    onmessage: null,

    /**
     * @param {*} message The job.
     */
    postMessage(message) {
      const job = /** @type {StyleJob} */ (message);
      // deferred, so that the pool is never called back from inside its own `postMessage`,
      // the way a real worker would not call it back either
      setTimeout(async () => {
        if (terminated) {
          return;
        }
        try {
          const handler = handlers[job.styleId];
          if (!handler) {
            throw new Error('No style registered for ' + job.styleId);
          }
          let pipeline = pipelines[job.styleId];
          if (!pipeline) {
            pipeline = compileStyle(
              handler.style,
              handler.bandCount,
              handler.nodataBandIndex,
            );
            pipelines[job.styleId] = pipeline;
          }
          context.data = job.data;
          context.size = job.size;
          context.bandCount = pipeline.bandCount;
          // integer data is normalized to the 0 to 1 range, matching how an integer texture
          // is sampled; floating point data passes through
          context.bandScale = job.data instanceof Float32Array ? 1 : 1 / 255;
          context.variables = job.variables || {};
          context.resolution = job.resolution ?? NaN;
          const rgba = render(pipeline, context);
          const bitmap = await createImageBitmap(
            new ImageData(/** @type {*} */ (rgba), job.size[0], job.size[1]),
          );
          if (terminated) {
            bitmap.close();
            return;
          }
          worker.onmessage?.({data: {bitmap: bitmap, size: job.size}});
        } catch (error) {
          if (!terminated) {
            worker.onmessage?.({
              data: {error: /** @type {Error} */ (error).message},
            });
          }
        }
      }, 0);
    },

    terminate() {
      terminated = true;
    },
  };
  return worker;
}
