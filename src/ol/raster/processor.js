/**
 * @module ol/raster/processor
 */
import Processor from '../Processor.js';
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
 * The pool is created when the first styled data tile is rendered, which is also when the
 * worker itself is fetched, and terminated when the last layer using it is disposed.  Set
 * this before rendering such a layer.
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
 * The pool wants a worker straight away, so this hands it one that holds on to messages
 * until the dynamically imported module arrives.
 * @return {import("../Processor.js").WorkerLike} The deferred worker.
 */
function createDeferredWorker() {
  /** @type {Array<[*, Array<Transferable>|undefined]>} */
  const pending = [];

  /** @type {import("../Processor.js").WorkerLike|null} */
  let worker = null;

  let terminated = false;

  /** @type {string|null} */
  let error = null;

  /** @type {import("../Processor.js").WorkerLike} */
  const deferred = {
    onmessage: null,
    postMessage: function (message, transfer) {
      if (terminated) {
        return;
      }
      if (worker) {
        worker.postMessage(message, transfer);
      } else if (error) {
        answerWithError();
      } else {
        pending.push([message, transfer]);
      }
    },
    terminate: function () {
      terminated = true;
      pending.length = 0;
      worker?.terminate();
    },
  };

  /**
   * Answer one message the worker will never answer, so that the tile waiting for it
   * fails instead of staying pending forever.  Asynchronously, like a real worker, so
   * that the pool is never called back while it is still dispatching.
   */
  function answerWithError() {
    Promise.resolve().then(() => {
      if (!terminated) {
        deferred.onmessage?.({data: {error: error}});
      }
    });
  }

  import('../worker/rasterStyle.js').then(
    ({create}) => {
      if (terminated) {
        return;
      }
      const created = /** @type {import("../Processor.js").WorkerLike} */ (
        /** @type {*} */ (create())
      );
      created.onmessage = (event) => deferred.onmessage?.(event);
      worker = created;
      for (const [message, transfer] of pending) {
        created.postMessage(message, transfer);
      }
      pending.length = 0;
    },
    (reason) => {
      error = `Failed to load the raster style worker: ${reason.message}`;
      const count = pending.length;
      pending.length = 0;
      for (let i = 0; i < count; ++i) {
        answerWithError();
      }
    },
  );

  return deferred;
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
      createWorker: workerCount ? createDeferredWorker : createMainThreadWorker,
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
