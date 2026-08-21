/**
 * A worker that turns data tile bands into rendered pixels using a raster style.
 *
 * All the work lives in `ol/raster/pipeline.js`, which compiles the style with the same
 * `ol/expr/cpu.js` the main thread uses for vector styling.  There is only ever one
 * implementation of the operators; the build step in `tasks/serialize-workers.cjs` bundles
 * this module and its imports into the worker source.  Keeping the pipeline out of here
 * also lets the main thread run the very same handler when workers are turned off with
 * {@link module:ol/raster/processor~setWorkerCount}.
 *
 * @module ol/worker/rasterStyle
 */
import {createJobHandler} from '../raster/pipeline.js';

/** @type {any} */
const worker = self;

const handleJob = createJobHandler();

worker.onmessage = async (/** @type {MessageEvent} */ event) => {
  const reply = await handleJob(event.data);
  worker.postMessage(reply, reply.bitmap ? [reply.bitmap] : []);
};

/** @type {function(): Worker} */ export let create;
