/**
 * @module ol/raster/processor
 */
import Processor from '../Processor.js';
import {create as createRasterStyleWorker} from '../worker/rasterStyle.js';
import {createJobHandler} from './pipeline.js';

/**
 * Leave a core to the main thread, and do not take over a machine that has many.
 * @type {number}
 */
let workerCount = Math.min(
  4,
  Math.max(1, (globalThis.navigator?.hardwareConcurrency || 2) - 1),
);

/**
 * @type {Processor|null}
 */
let processor = null;

/**
 * How many renderers are holding on to the pool.
 * @type {number}
 */
let users = 0;

/**
 * Set the number of workers that apply raster styles to data tiles.  Every layer shares
 * one pool, so this is how many style threads the page has in total, not how many each
 * layer gets.
 *
 * Set `0` to apply styles on the main thread instead.  Styling a tile then blocks
 * everything else for as long as it takes, but it is how raster styles work under a
 * content security policy that does not allow `worker-src blob:`.
 *
 * The pool is created when the first styled data tile is rendered and terminated when the
 * last layer using it is disposed, so set this before rendering such a layer.
 *
 * @param {number} count The number of workers.
 * @api
 */
export function setWorkerCount(count) {
  workerCount = Math.max(0, Math.round(count));
}

/**
 * The number of workers that apply raster styles to data tiles.
 * @return {number} The number of workers.
 * @api
 */
export function getWorkerCount() {
  return workerCount;
}

/**
 * A worker shaped object that runs jobs on the main thread, for a worker count of 0.  It
 * runs the same handler a real worker does, and answers asynchronously like one, so the
 * pool cannot tell the difference.
 * @return {import("../Processor.js").WorkerLike} The faux worker.
 */
function createMainThreadWorker() {
  const handleJob = createJobHandler();
  let terminated = false;
  /** @type {import("../Processor.js").WorkerLike} */
  const worker = {
    onmessage: null,
    postMessage: function (message) {
      handleJob(message).then((reply) => {
        if (!terminated) {
          worker.onmessage?.({data: reply});
        }
      });
    },
    terminate: function () {
      terminated = true;
    },
  };
  return worker;
}

/**
 * Take a hold on the pool that applies raster styles, creating it if this is the first
 * one, so that an application without styled data tiles never spawns a worker.  Every
 * hold must be given back with {@link releaseProcessor}.
 * @return {Processor} The shared processor.
 */
export function acquireProcessor() {
  if (!processor) {
    processor = new Processor({
      threads: workerCount,
      queue: Infinity,
      createWorker: workerCount
        ? /** @type {function(): import("../Processor.js").WorkerLike} */ (
            /** @type {*} */ (createRasterStyleWorker)
          )
        : createMainThreadWorker,
    });
  }
  ++users;
  return processor;
}

/**
 * Give back a hold taken with {@link acquireProcessor}.  The workers are terminated once
 * nothing holds the pool any more.
 */
export function releaseProcessor() {
  --users;
  if (users === 0 && processor) {
    processor.dispose();
    processor = null;
  }
}
