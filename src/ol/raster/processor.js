/**
 * @module ol/raster/processor
 */
import Processor from '../Processor.js';
import {warn} from '../console.js';
import {createFallbackWorker} from './fallback.js';
import {compileStyleToSource} from './pipeline.js';
import {buildWorkerSource, createWorker} from './workerSource.js';

/**
 * Leave a core to the main thread, and do not take over a machine that has many.
 * @type {number}
 */
let workerCount = Math.min(
  4,
  Math.max(1, (globalThis.navigator?.hardwareConcurrency || 2) - 1),
);

/**
 * Set the number of workers that apply raster styles to data tiles.  Every layer shares
 * one pool, so this is how many style threads the page has in total, not how many each
 * layer gets. Set this before rendering styled data tile layers with the canvas renderer.
 *
 * @param {number} count The number of workers, at least one.
 * @api
 */
export function setWorkerCount(count) {
  workerCount = Math.max(1, Math.round(count));
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
 * A style compiled for one band layout.  The style itself is kept beside the source, because
 * {@link module:ol/raster/fallback} needs the style rather than the source.
 *
 * @typedef {Object} Handler
 * @property {string} source The render function source, baked into the worker.
 * @property {import('../style/raster.js').RasterStyle} style The style it was compiled from.
 * @property {number} bandCount The number of bands per pixel.
 * @property {number|undefined} nodataBandIndex The 1-based nodata band index.
 */

/**
 * Compiled handlers by id.  A handler is specific to a style *and* to the band layout it was
 * compiled for, because the band count is baked into the emitted loop.  The layout is only
 * known once a tile's data has arrived, so handlers are registered on first use rather than
 * when the style is set.
 * @type {Object<string, Handler>}
 */
const handlers = {};

/**
 * The pool running generated workers.  Dropped whenever the handler table changes, and built
 * again on the next job.
 * @type {Processor|null}
 */
let styleProcessor = null;

/**
 * Whether generated workers have been given up on, which is for good: what stops one from
 * starting is a content security policy or a bug in the emitter, and neither changes while
 * the page lives.
 * @type {boolean}
 */
let workersRefused = false;

/**
 * @param {string} styleId Identifies the style, as `layerUid/styleRevision`.
 * @param {number} bandCount The number of bands per pixel.
 * @param {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @return {string} The handler id.
 */
function handlerId(styleId, bandCount, nodataBandIndex) {
  return `${styleId}/${bandCount}/${nodataBandIndex ?? ''}`;
}

/**
 * @private
 */
function dropStyleProcessor() {
  // abandon rather than dispose: a job for another layer may be in flight, and it should be
  // asked for again on the new pool rather than left waiting forever.  Cleared first, because
  // that is what the asking happens in, and it has to reach the new pool.
  const previous = styleProcessor;
  styleProcessor = null;
  previous?.abandon();
}

/**
 * Give up on generated workers and drop the pool holding them, so that every job it was
 * carrying is asked for again — on the fallback pool the next {@link getStyleProcessor}
 * builds.  Deciding this late is what it takes: a worker that a policy refuses reports it
 * only once the jobs are already on their way to it.
 *
 * @param {string} reason Why the worker cannot be used.
 */
function useFallback(reason) {
  if (workersRefused) {
    return;
  }
  workersRefused = true;
  warn(
    `Cannot run raster styles in a worker, so they are applied on the main thread instead: ${reason}`,
  );
  dropStyleProcessor();
}

/**
 * Whether a newer revision of the same layer's style is already compiled, which means this one
 * has been replaced and nothing should be styled with it any more.
 * @param {string} styleId Identifies the style, as `layerUid/styleRevision`.
 * @return {boolean} The style has been superseded.
 */
function isSuperseded(styleId) {
  const slash = styleId.indexOf('/') + 1;
  const prefix = styleId.slice(0, slash);
  const revision = Number(styleId.slice(slash));
  return Object.keys(handlers).some(
    (id) =>
      id.startsWith(prefix) &&
      Number(id.slice(slash, id.indexOf('/', slash))) > revision,
  );
}

/**
 * Forget every handler whose id starts with a prefix, except those starting with `keep`.
 * @param {string} prefix The handler id prefix to drop.
 * @param {string} [keep] A longer prefix to spare.
 * @return {boolean} Whether anything was dropped.
 */
function dropMatching(prefix, keep) {
  let dropped = false;
  for (const id of Object.keys(handlers)) {
    if (id.startsWith(prefix) && !(keep && id.startsWith(keep))) {
      delete handlers[id];
      dropped = true;
    }
  }
  return dropped;
}

/**
 * Make sure a compiled handler exists for a style and band layout, and answer the id a job
 * should name.  Registering a new handler invalidates the pool, so this returns the same id
 * without doing anything once the handler is there — which is every call after the first.
 *
 * Throws for a style the emitter cannot compile, which
 * {@link module:ol/raster/style~validateStyle} has already rejected where the style was set.
 *
 * @param {string} styleId Identifies the style, as `layerUid/styleRevision`.
 * @param {import('../style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {number|undefined} nodataBandIndex The 1-based nodata band index.
 * @return {string|null} The handler id, or null for a style that has been superseded.
 */
export function ensureHandler(styleId, style, bandCount, nodataBandIndex) {
  const id = handlerId(styleId, bandCount, nodataBandIndex);
  if (id in handlers) {
    return id;
  }
  if (isSuperseded(styleId)) {
    // the layer has a newer style, and this one was asked for by a tile that has not been
    // told yet.  Compiling it again would take the newer style out of the worker being
    // built for it, so the tile is left to be styled again with the style it will get.
    return null;
  }
  const source = compileStyleToSource(style, bandCount, nodataBandIndex);

  // a new style revision supersedes the previous one for the same layer, whatever band
  // layouts it was compiled for
  dropMatching(styleId.slice(0, styleId.indexOf('/') + 1), `${styleId}/`);

  handlers[id] = {
    source: source,
    style: style,
    bandCount: bandCount,
    nodataBandIndex: nodataBandIndex,
  };
  dropStyleProcessor();
  return id;
}

/**
 * Forget every handler compiled for a layer, whatever style revision or band layout it was
 * compiled for, so a layer going away does not keep its style in the worker.
 * @param {string} layerUid The layer's uid.
 */
export function dropLayerHandlers(layerUid) {
  if (dropMatching(`${layerUid}/`)) {
    dropStyleProcessor();
  }
}

/**
 * The pool that runs compiled styles.  Built from the handlers registered so far, and rebuilt
 * whenever that set changes.
 * @return {Processor} The processor.
 */
export function getStyleProcessor() {
  if (styleProcessor) {
    return styleProcessor;
  }
  if (!workersRefused) {
    /** @type {Object<string, string>} */
    const sources = {};
    for (const id in handlers) {
      sources[id] = handlers[id].source;
    }
    const source = buildWorkerSource(sources);
    try {
      styleProcessor = new Processor({
        threads: workerCount,
        queue: Infinity,
        createWorker: () => {
          const worker = createWorker(source);
          // A policy that forbids `blob:` worker urls does not make the line above throw: the
          // url is simply never loaded, and the worker says so with an error event carrying
          // nothing.  A worker that fails to start for any other reason says the same thing
          // and needs the same answer, since either way it will never answer a job.
          worker.onerror = () => useFallback('the worker did not start');
          return /** @type {import("../Processor.js").WorkerLike} */ (
            /** @type {*} */ (worker)
          );
        },
      });
      return styleProcessor;
    } catch (error) {
      // where a policy is enforced by refusing the url outright.  The first worker is the one
      // refused, so the pool is never left holding any that would need terminating here.
      useFallback(/** @type {Error} */ (error).message);
    }
  }
  styleProcessor = new Processor({
    // the fallback renders on the main thread, so a second one of it would only take turns
    // with the first
    threads: 1,
    queue: Infinity,
    createWorker: () => createFallbackWorker(handlers),
  });
  return styleProcessor;
}
