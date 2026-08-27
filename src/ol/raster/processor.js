/**
 * @module ol/raster/processor
 */
import Processor from '../Processor.js';

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
let styleProcessor = null;

/**
 * Set the number of workers that apply raster styles to data tiles.  Every layer shares
 * one pool, so this is how many style threads the page has in total, not how many each
 * layer gets.
 *
 * @param {number} count The number of workers, at least one.
 * @api
 */
export function setWorkerCount(count) {
  workerCount = Math.max(1, Math.round(count));
  const previous = styleProcessor;
  styleProcessor = null;
  previous?.abandon();
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
 * A stand-in for the style worker while its serialized module is being loaded, which only
 * happens once a tile is styled.
 * @return {import("../Processor.js").WorkerLike} The worker.
 */
function createStyleWorker() {
  /** @type {Array<[*, Array<Transferable>|undefined]>} */
  const pending = [];
  /** @type {import("../Processor.js").WorkerLike|null} */
  let worker = null;
  let terminated = false;

  /** @type {import("../Processor.js").WorkerLike} */
  const proxy = {
    onmessage: null,
    postMessage(message, transfer) {
      if (worker) {
        worker.postMessage(message, transfer);
        return;
      }
      pending.push([message, transfer]);
    },
    terminate() {
      terminated = true;
      worker?.terminate();
    },
  };

  import('../worker/rasterStyle.js').then(({create}) => {
    if (terminated) {
      return;
    }
    const created = /** @type {import("../Processor.js").WorkerLike} */ (
      /** @type {*} */ (create())
    );
    created.onmessage = (event) => proxy.onmessage?.(event);
    for (const [message, transfer] of pending) {
      created.postMessage(message, transfer);
    }
    pending.length = 0;
    worker = created;
  });

  return proxy;
}

/**
 * The pool that applies raster styles.
 * @return {Processor} The processor.
 */
export function getStyleProcessor() {
  if (!styleProcessor) {
    styleProcessor = new Processor({
      threads: workerCount,
      queue: Infinity,
      createWorker: createStyleWorker,
    });
  }
  return styleProcessor;
}
