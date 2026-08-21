/**
 * A worker that turns data tile bands into rendered pixels using a raster style.
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
