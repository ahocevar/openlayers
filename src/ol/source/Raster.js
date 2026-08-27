/**
 * @module ol/source/Raster
 */
import ImageCanvas from '../ImageCanvas.js';
import Processor from '../Processor.js';
import TileQueue from '../TileQueue.js';
import {createCanvasContext2D} from '../dom.js';
import Event from '../events/Event.js';
import EventType from '../events/EventType.js';
import {equals, getCenter, getHeight, getWidth} from '../extent.js';
import ImageLayer from '../layer/Image.js';
import TileLayer from '../layer/Tile.js';
import {create as createTransform} from '../transform.js';
import {getUid} from '../util.js';
import ImageSource from './Image.js';
import Source from './Source.js';
import TileSource from './Tile.js';

/**
 * Re-exported for backwards compatibility.
 */
export {Processor};

/**
 * A function that takes an array of input data, performs some operation, and
 * returns an array of output data.
 * For `pixel` type operations, the function will be called with an array of
 * pixels, where each pixel is an array of four numbers (`[r, g, b, a]`) in the
 * range of 0 - 255. It should return a single pixel array.
 * For `'image'` type operations, functions will be called with an array of
 * [ImageData](https://developer.mozilla.org/en-US/docs/Web/API/ImageData)
 * and should return a single
 * [ImageData](https://developer.mozilla.org/en-US/docs/Web/API/ImageData).
 * The operations
 * are called with a second "data" argument, which can be used for storage.  The
 * data object is accessible from raster events, where it can be initialized in
 * "beforeoperations" and accessed again in "afteroperations".
 *
 * @typedef {function((Array<Array<number>>|Array<ImageData>), Object):
 *     (Array<number>|ImageData)} Operation
 */

/**
 * @enum {string}
 */
const RasterEventType = {
  /**
   * Triggered before operations are run.  Listeners will receive an event object with
   * a `data` property that can be used to make data available to operations.
   * @event module:ol/source/Raster.RasterSourceEvent#beforeoperations
   * @api
   */
  BEFOREOPERATIONS: 'beforeoperations',

  /**
   * Triggered after operations are run.  Listeners will receive an event object with
   * a `data` property.  If more than one thread is used, `data` will be an array of
   * objects.  If a single thread is used, `data` will be a single object.
   * @event module:ol/source/Raster.RasterSourceEvent#afteroperations
   * @api
   */
  AFTEROPERATIONS: 'afteroperations',
};

/**
 * @typedef {'pixel' | 'image'} RasterOperationType
 * Raster operation type. Supported values are `'pixel'` and `'image'`.
 */

/**
 * @typedef {import("./Image.js").ImageSourceEventTypes|'beforeoperations'|'afteroperations'} RasterSourceEventTypes
 */

/**
 * @classdesc
 * Events emitted by {@link module:ol/source/Raster~RasterSource} instances are instances of this
 * type.
 */
export class RasterSourceEvent extends Event {
  /**
   * @param {string} type Type.
   * @param {import("../Map.js").FrameState} frameState The frame state.
   * @param {Object|Array<Object>} data An object made available to operations.  For "afteroperations" evenets
   * this will be an array of objects if more than one thread is used.
   */
  constructor(type, frameState, data) {
    super(type);

    /**
     * The raster extent.
     * @type {import("../extent.js").Extent}
     * @api
     */
    this.extent = /** @type {import("../extent.js").Extent} */ (
      frameState.extent
    );

    /**
     * The pixel resolution (map units per pixel).
     * @type {number}
     * @api
     */
    this.resolution = frameState.viewState.resolution / frameState.pixelRatio;

    /**
     * An object made available to all operations.  This can be used by operations
     * as a storage object (e.g. for calculating statistics).
     * @type {Object}
     * @api
     */
    this.data = data;
  }
}

/**
 * @typedef {Object} Options
 * @property {Array<import("./Source.js").default|import("../layer/Layer.js").default>} sources Input
 * sources or layers.
 * @property {Operation} [operation] Raster operation.
 * The operation will be called with data from input sources
 * and the output will be assigned to the raster source.
 * @property {boolean} [interpolate=true] Use interpolated values when resampling. By default,
 * linear interpolation is used when resampling. Set to `false` to use the nearest neighbor instead.
 * @property {Object} [lib] Functions that will be made available to operations run in a worker.
 * @property {number} [threads] By default, operations will be run in a single worker thread.
 * To avoid using workers altogether, set `threads: 0`.  For pixel operations, operations can
 * be run in multiple worker threads.  Note that there is additional overhead in
 * transferring data to multiple workers, and that depending on the user's
 * system, it may not be possible to parallelize the work.
 * @property {RasterOperationType} [operationType='pixel'] Operation type.
 * Supported values are `'pixel'` and `'image'`.  By default,
 * `'pixel'` operations are assumed, and operations will be called with an
 * array of pixels from input sources.  If set to `'image'`, operations will
 * be called with an array of ImageData objects from input sources.
 * @property {Array<number>|null} [resolutions] Resolutions. If specified, raster operations will only
 * be run at the given resolutions.  By default, the resolutions of the first source with resolutions
 * specified will be used, if any. Set to `null` to use any view resolution instead.
 */

/***
 * @template Return
 * @typedef {import("../Observable.js").OnSignature<import("../Observable.js").EventTypes, import("../events/Event.js").default, Return> &
 *   import("../Observable.js").OnSignature<import("../ObjectEventType.js").Types, import("../Object.js").ObjectEvent, Return> &
 *   import("../Observable.js").OnSignature<import("./Image.js").ImageSourceEventTypes, import("./Image.js").ImageSourceEvent, Return> &
 *   import("../Observable.js").OnSignature<RasterSourceEventTypes, RasterSourceEvent, Return> &
 *   import("../Observable.js").CombinedOnSignature<import("../Observable.js").EventTypes|import("../ObjectEventType.js").Types
 *     |RasterSourceEventTypes, Return>} RasterSourceOnSignature
 */

/**
 * @classdesc
 * A source that transforms data from any number of input sources using an
 * {@link module:ol/source/Raster~Operation} function to transform input pixel values into
 * output pixel values.
 *
 * @fires module:ol/source/Raster.RasterSourceEvent
 * @api
 */
class RasterSource extends ImageSource {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    super({
      interpolate: options.interpolate,
      projection: undefined,
    });

    /***
     * @type {RasterSourceOnSignature<import("../events.js").EventsKey>}
     */
    this.on;

    /***
     * @type {RasterSourceOnSignature<import("../events.js").EventsKey>}
     */
    this.once;

    /***
     * @type {RasterSourceOnSignature<void>}
     */
    this.un;

    /**
     * @private
     * @type {Processor|undefined}
     */
    this.processor_ = undefined;

    /**
     * @private
     * @type {RasterOperationType}
     */
    this.operationType_ =
      options.operationType !== undefined ? options.operationType : 'pixel';

    /**
     * @private
     * @type {number}
     */
    this.threads_ = options.threads !== undefined ? options.threads : 1;

    /**
     * @private
     * @type {Array<import("../layer/Layer.js").default>}
     */
    this.layers_ = createLayers(options.sources);

    const changed = this.changed.bind(this);
    for (let i = 0, ii = this.layers_.length; i < ii; ++i) {
      this.layers_[i].addEventListener(EventType.CHANGE, changed);
    }

    /**
     * @private
     * @type {boolean}
     */
    this.useResolutions_ = options.resolutions !== null;

    /**
     * @private
     * @type {import("../TileQueue.js").default}
     */
    this.tileQueue_ = new TileQueue(function () {
      return 1;
    }, this.processSources_.bind(this));

    /**
     * The most recently requested frame state.
     * @type {import("../Map.js").FrameState}
     * @private
     */
    this.requestedFrameState_;

    /**
     * The most recently rendered image canvas.
     * @type {import("../ImageCanvas.js").default|undefined}
     * @private
     */
    this.renderedImageCanvas_ = undefined;

    /**
     * The most recently rendered revision.
     * @type {number}
     * @private
     */
    this.renderedRevision_;

    /**
     * @private
     * @type {import("../Map.js").FrameState}
     */
    this.frameState_ = {
      animate: false,
      coordinateToPixelTransform: createTransform(),
      declutter: null,
      extent: null,
      index: 0,
      layerIndex: 0,
      layerStatesArray: getLayerStatesArray(this.layers_),
      pixelRatio: 1,
      pixelToCoordinateTransform: createTransform(),
      postRenderFunctions: [],
      size: [0, 0],
      tileQueue: this.tileQueue_,
      time: Date.now(),
      usedTiles: {},
      viewState: /** @type {import("../View.js").State} */ ({
        rotation: 0,
      }),
      viewHints: [],
      wantedTiles: {},
      mapId: getUid(this),
      renderTargets: {},
    };

    this.setAttributions(function (frameState) {
      /** @type {Array<string>} */
      const attributions = [];
      for (let i = 0, iMax = options.sources.length; i < iMax; ++i) {
        const sourceOrLayer = options.sources[i];
        const source =
          sourceOrLayer instanceof Source
            ? sourceOrLayer
            : sourceOrLayer.getSource();
        if (!source) {
          continue;
        }
        const sourceAttributions = source.getAttributions()?.(frameState);
        if (typeof sourceAttributions === 'string') {
          attributions.push(sourceAttributions);
        } else if (sourceAttributions !== undefined) {
          attributions.push(...sourceAttributions);
        }
      }
      return attributions;
    });

    if (options.operation !== undefined) {
      this.setOperation(
        options.operation,
        /** @type {Object<string, Function>|undefined} */ (options.lib),
      );
    }
  }

  /**
   * Set the operation.
   * @param {Operation} operation New operation.
   * @param {Object<string, Function>} [lib] Functions that will be available to operations run
   *     in a worker.
   * @api
   */
  setOperation(operation, lib) {
    if (this.processor_) {
      this.processor_.dispose();
    }

    this.processor_ = new Processor({
      operation: operation,
      imageOps: this.operationType_ === 'image',
      queue: 1,
      lib: /** @type {Object<string, Function>|undefined} */ (lib),
      threads: this.threads_,
    });
    this.changed();
  }

  /**
   * Update the stored frame state.
   * @param {import("../extent.js").Extent} extent The view extent (in map units).
   * @param {number} resolution The view resolution.
   * @param {import("../proj/Projection.js").default} projection The view projection.
   * @return {import("../Map.js").FrameState} The updated frame state.
   * @private
   */
  updateFrameState_(extent, resolution, projection) {
    const frameState = /** @type {import("../Map.js").FrameState} */ (
      Object.assign({}, this.frameState_)
    );

    frameState.viewState = /** @type {import("../View.js").State} */ (
      Object.assign({}, frameState.viewState)
    );

    const center = getCenter(extent);

    frameState.size[0] = Math.ceil(getWidth(extent) / resolution);
    frameState.size[1] = Math.ceil(getHeight(extent) / resolution);
    frameState.extent = [
      center[0] - (frameState.size[0] * resolution) / 2,
      center[1] - (frameState.size[1] * resolution) / 2,
      center[0] + (frameState.size[0] * resolution) / 2,
      center[1] + (frameState.size[1] * resolution) / 2,
    ];
    frameState.time = Date.now();

    const viewState = frameState.viewState;
    viewState.center = center;
    viewState.projection = projection;
    viewState.resolution = resolution;
    return frameState;
  }

  /**
   * Determine if all sources are ready.
   * @return {boolean} All sources are ready.
   * @private
   */
  allSourcesReady_() {
    let ready = true;
    let source;
    for (let i = 0, ii = this.layers_.length; i < ii; ++i) {
      source = this.layers_[i].getSource();
      if (!source || source.getState() !== 'ready') {
        ready = false;
        break;
      }
    }
    return ready;
  }

  /**
   * @param {import("../extent.js").Extent} extent Extent.
   * @param {number} resolution Resolution.
   * @param {number} pixelRatio Pixel ratio.
   * @param {import("../proj/Projection.js").default} projection Projection.
   * @return {import("../ImageCanvas.js").default|null} Single image.
   * @override
   */
  getImage(extent, resolution, pixelRatio, projection) {
    if (!this.allSourcesReady_()) {
      return null;
    }

    this.tileQueue_.loadMoreTiles(16, 16);

    resolution = this.findNearestResolution(resolution);
    const frameState = this.updateFrameState_(extent, resolution, projection);
    this.requestedFrameState_ = frameState;

    // check if we can't reuse the existing ol/ImageCanvas
    if (this.renderedImageCanvas_) {
      const renderedResolution = this.renderedImageCanvas_.getResolution();
      const renderedExtent = this.renderedImageCanvas_.getExtent();
      if (
        resolution !== renderedResolution ||
        !equals(
          /** @type {import("../extent.js").Extent} */ (frameState.extent),
          /** @type {import("../extent.js").Extent} */ (renderedExtent),
        )
      ) {
        this.renderedImageCanvas_ = undefined;
      }
    }

    if (
      !this.renderedImageCanvas_ ||
      this.getRevision() !== this.renderedRevision_
    ) {
      this.processSources_();
    }

    if (frameState.animate) {
      requestAnimationFrame(this.changed.bind(this));
    }

    return this.renderedImageCanvas_ ?? null;
  }

  /**
   * Start processing source data.
   * @private
   */
  processSources_() {
    const frameState = this.requestedFrameState_;
    const len = this.layers_.length;
    const sourceRevisions = new Array(len);
    const imageDatas = new Array(len);
    for (let i = 0; i < len; ++i) {
      const source = this.layers_[i].getSource();
      if (!source) {
        return;
      }
      sourceRevisions[i] = source.getRevision();
      frameState.layerIndex = i;
      frameState.renderTargets = {};
      const imageData = getImageData(this.layers_[i], frameState);
      if (imageData) {
        imageDatas[i] = imageData;
      } else {
        return;
      }
    }

    const data = {};
    this.dispatchEvent(
      new RasterSourceEvent(RasterEventType.BEFOREOPERATIONS, frameState, data),
    );
    this.processor_?.process(
      imageDatas,
      data,
      this.onWorkerComplete_.bind(this, frameState, sourceRevisions),
    );
  }

  /**
   * Called when pixel processing is complete.
   * @param {import("../Map.js").FrameState} frameState The frame state.
   * @param {Array<number>} sourceRevisions Source revisions when processing started.
   * @param {Error|null} err Any error during processing.
   * @param {ImageData|null} output The output image data.
   * @param {Object|Array<Object>} data The user data (or an array if more than one thread).
   * @private
   */
  onWorkerComplete_(frameState, sourceRevisions, err, output, data) {
    if (err || !output) {
      return;
    }

    // do nothing if extent or resolution changed
    const extent = frameState.extent;
    const resolution = frameState.viewState.resolution;
    if (
      resolution !== this.requestedFrameState_.viewState.resolution ||
      !equals(
        /** @type {import("../extent.js").Extent} */ (extent),
        /** @type {import("../extent.js").Extent} */ (
          this.requestedFrameState_.extent
        ),
      )
    ) {
      return;
    }
    // do nothing if any input source's revision changed
    for (let i = 0; i < this.layers_.length; ++i) {
      const source = this.layers_[i].getSource();
      if (!source) {
        return;
      }
      if (sourceRevisions[i] !== source.getRevision()) {
        return;
      }
    }

    let context;
    if (this.renderedImageCanvas_) {
      context =
        /** @type {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} */ (
          this.renderedImageCanvas_.getImage().getContext('2d')
        );
    } else {
      const width = frameState.size[0];
      const height = frameState.size[1];
      context = createCanvasContext2D(width, height);
      this.renderedImageCanvas_ = new ImageCanvas(
        /** @type {import("../extent.js").Extent} */ (extent),
        resolution,
        1,
        context.canvas,
      );
    }
    context.putImageData(output, 0, 0);

    if (frameState.animate) {
      requestAnimationFrame(this.changed.bind(this));
    } else {
      this.changed();
    }
    this.renderedRevision_ = this.getRevision();

    this.dispatchEvent(
      new RasterSourceEvent(RasterEventType.AFTEROPERATIONS, frameState, data),
    );
  }

  /**
   * @param {import("../proj/Projection.js").default} [projection] Projection.
   * @return {Array<number>|null} Resolutions.
   * @override
   */
  getResolutions(projection) {
    if (!this.useResolutions_) {
      return null;
    }
    let resolutions = super.getResolutions();
    if (!resolutions) {
      for (let i = 0, ii = this.layers_.length; i < ii; ++i) {
        const source = this.layers_[i].getSource();
        if (!source) {
          continue;
        }
        resolutions = source.getResolutions(projection);
        if (resolutions) {
          break;
        }
      }
    }
    return resolutions;
  }

  /**
   * @override
   */
  disposeInternal() {
    if (this.processor_) {
      this.processor_.dispose();
    }
    super.disposeInternal();
  }
}

/**
 * Clean up and unregister the worker.
 * @function
 * @api
 */
RasterSource.prototype.dispose;

/**
 * A reusable canvas context.
 * @type {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|undefined}
 * @private
 */
let sharedContext = undefined;

/**
 * Get image data from a layer.
 * @param {import("../layer/Layer.js").default} layer Layer to render.
 * @param {import("../Map.js").FrameState} frameState The frame state.
 * @return {ImageData|null} The image data.
 */
function getImageData(layer, frameState) {
  const renderer = layer.getRenderer();
  if (!renderer) {
    throw new Error('Unsupported layer type: ' + layer);
  }

  if (!renderer.prepareFrame(frameState)) {
    return null;
  }
  const width = frameState.size[0];
  const height = frameState.size[1];
  if (width === 0 || height === 0) {
    return null;
  }
  const container = renderer.renderFrame(frameState, null);
  let element;
  if (container instanceof HTMLCanvasElement) {
    element = container;
  } else {
    if (container) {
      element = container.firstElementChild;
    }
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error('Unsupported rendered element: ' + element);
    }
    if (element.width === width && element.height === height) {
      const context = element.getContext('2d');
      if (context) {
        return context.getImageData(0, 0, width, height);
      }
    }
  }

  if (!sharedContext) {
    sharedContext = createCanvasContext2D(width, height, undefined, {
      willReadFrequently: true,
    });
  } else {
    const canvas = sharedContext.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      sharedContext = createCanvasContext2D(width, height, undefined, {
        willReadFrequently: true,
      });
    } else {
      sharedContext.clearRect(0, 0, width, height);
    }
  }
  sharedContext.drawImage(element, 0, 0, width, height);
  return /** @type {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} */ (
    sharedContext
  ).getImageData(0, 0, width, height);
}

/**
 * Get a list of layer states from a list of layers.
 * @param {Array<import("../layer/Layer.js").default>} layers Layers.
 * @return {Array<import("../layer/Layer.js").State>} The layer states.
 */
function getLayerStatesArray(layers) {
  return layers.map(function (layer) {
    return layer.getLayerState();
  });
}

/**
 * Create layers for all sources.
 * @param {Array<import("./Source.js").default|import("../layer/Layer.js").default>} sources The sources.
 * @return {Array<import("../layer/Layer.js").default>} Array of layers.
 */
function createLayers(sources) {
  const len = sources.length;
  const layers = new Array(len);
  for (let i = 0; i < len; ++i) {
    layers[i] = createLayer(sources[i]);
  }
  return layers;
}

/**
 * Create a layer for the provided source.
 * @param {import("./Source.js").default|import("../layer/Layer.js").default} layerOrSource The layer or source.
 * @return {import("../layer/Layer.js").default} The layer.
 */
function createLayer(layerOrSource) {
  // @type {import("../layer/Layer.js").default}
  let layer;
  if (layerOrSource instanceof Source) {
    if (layerOrSource instanceof TileSource) {
      layer = new TileLayer({source: layerOrSource});
    } else if (layerOrSource instanceof ImageSource) {
      layer = new ImageLayer({source: layerOrSource});
    } else {
      throw new Error('Unsupported source type: ' + layerOrSource);
    }
  } else {
    layer = layerOrSource;
  }
  return layer;
}

export default RasterSource;
