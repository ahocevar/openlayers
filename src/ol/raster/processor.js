/**
 * @module ol/raster/processor
 */
import Processor from '../Processor.js';
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
 * Compiled render source by handler id.  A handler is specific to a style *and* to the band
 * layout it was compiled for, because the band count is baked into the emitted loop.  The
 * layout is only known once a tile's data has arrived, so handlers are registered on first
 * use rather than when the style is set.
 * @type {Object<string, string>}
 */
const handlers = {};

/**
 * The pool running generated workers.  Dropped whenever the handler table changes, and built
 * again on the next job.
 * @type {Processor|null}
 */
let styleProcessor = null;

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

  handlers[id] = source;
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
  if (!styleProcessor) {
    const source = buildWorkerSource(handlers);
    styleProcessor = new Processor({
      threads: workerCount,
      queue: Infinity,
      createWorker: () =>
        /** @type {import("../Processor.js").WorkerLike} */ (
          /** @type {*} */ (createWorker(source))
        ),
    });
  }
  return styleProcessor;
}
