/**
 * @module ol/raster/StyledTile
 */
import {
  asArrayLike,
  asImageLike,
  getBandCount,
  toArray,
  toImageData,
} from '../DataTile.js';
import Tile from '../Tile.js';
import TileState from '../TileState.js';
import {error as logError} from '../console.js';
import {listen, unlistenByKey} from '../events.js';
import EventType from '../events/EventType.js';
import {ensureHandler, getStyleProcessor} from './processor.js';

/**
 * @typedef {Object} Options
 * @property {number} [gutter=0] The gutter around the tile data.
 * @property {import("../style/raster.js").RasterStyle} [style] The raster style.  Without
 * one the bands are expanded to RGBA the way an unstyled data tile is rendered.
 * @property {number} [revision=0] The style revision this is made for.
 * @property {string} [styleId] Identifies the style to the worker pool, which compiles a
 * style once and keeps it.  Every layer shares the pool, so this has to be unique across
 * layers, not just across revisions of one style.
 * @property {number} [nodataBandIndex] The 1-based index of the band marking nodata.
 * @property {import("../style/raster.js").RasterStyleVariables} [variables] The style variables,
 * with the ones used as colors resolved to rgba arrays.
 * @property {number} [resolution] The resolution the style is applied at, read by
 * `['resolution']`.  Only meaningful for a style that uses it; see the render policy in
 * {@link module:ol/renderer/canvas/TileLayer}.
 */

/**
 * @classdesc
 * A data tile's data turned into something the canvas renderer can draw.  Without a style
 * that is a band-to-RGBA conversion, and image data is passed through untouched; with one
 * it is a job on a worker pool, reading image data as rgba bands.
 *
 * A tile in its own right, so that {@link module:ol/reproj/Tile~ReprojTile} can warp the
 * result the way it warps any other image tile.
 *
 * This is the canvas counterpart of {@link module:ol/webgl/BaseTileRepresentation}.
 */
class StyledTile extends Tile {
  /**
   * @param {import("../DataTile.js").default} tile The tile holding the data.
   * @param {Options} [options] Options.
   */
  constructor(tile, options) {
    options = options || {};

    // transitions are the business of the tile that wraps this one
    super(tile.tileCoord, TileState.IDLE, {transition: 0});

    /**
     * @type {import("../DataTile.js").default}
     */
    this.tile = tile;

    /**
     * @type {Options}
     * @private
     */
    this.options_ = options;

    /**
     * The style revision this represents.
     * @type {number}
     */
    this.revision = options.revision || 0;

    /**
     * The resolution the style was applied at, for a style that reads `['resolution']`.
     * Undefined for every other style, which stays valid at any resolution.
     * @type {number|undefined}
     */
    this.resolution = options.resolution;

    /**
     * @type {import("../DataTile.js").ImageLike|null}
     * @private
     */
    this.image_ = null;

    /**
     * Whether the image was made here.  Closing one that came from the tile would take
     * the tile's data away.
     * @type {boolean}
     * @private
     */
    this.ownsImage_ = false;

    /**
     * The pixels the style is applied to, kept so that restyling for a new revision does
     * not read an image back again.
     * @type {Uint8Array|Uint8ClampedArray|Float32Array|null}
     * @private
     */
    this.values_ = null;

    /**
     * @type {import("../Processor.js").Job|null}
     * @private
     */
    this.job_ = null;

    /**
     * The pool the current job was posted to.  It is replaced whenever the set of styles it
     * serves changes, so the job has to be cancelled on the pool that runs it.
     * @type {import("../Processor.js").default|null}
     * @private
     */
    this.styleProcessor_ = null;

    /**
     * @type {import("../events.js").EventsKey|null}
     * @private
     */
    this.tileListenerKey_ = null;
  }

  /**
   * Whether the pixels are the ones the current style makes.  A tile that failed counts as
   * settled, so that rendering does not wait on it forever.
   * @return {boolean} The tile has settled.
   */
  isReady() {
    const state = this.getState();
    return state === TileState.LOADED || state === TileState.ERROR;
  }

  /**
   * Whether there is something to draw.  A tile being styled again still has the pixels
   * from the style before it.
   * @return {boolean} The tile can be drawn.
   */
  isDrawable() {
    return !!this.image_ || this.isReady();
  }

  /**
   * @return {import("../DataTile.js").ImageLike|null} The drawable pixels.
   */
  getImage() {
    return this.image_;
  }

  /**
   * Apply a style again, for a new style revision.  The pixels and the data they were made
   * from stay until the new ones are here.
   * @param {Options} options The options for the new revision.
   */
  restyle(options) {
    this.cancelJob_();
    this.options_ = options;
    this.revision = options.revision || 0;
    this.resolution = options.resolution;

    if (this.state === TileState.IDLE || this.tileListenerKey_) {
      // nothing applied yet, so the next apply picks the new options up
      return;
    }
    // not `setState` - there is nothing new to draw yet
    this.state = TileState.LOADING;
    if (this.tile.getState() === TileState.LOADED) {
      this.apply_();
    }
  }

  /**
   * The pixel size of the tile data, gutter included.
   * @return {import("../size.js").Size} The pixel size.
   * @private
   */
  getPixelSize_() {
    const gutter = this.options_.gutter || 0;
    const size = this.tile.getSize();
    return [size[0] + 2 * gutter, size[1] + 2 * gutter];
  }

  /**
   * @override
   */
  load() {
    if (this.state !== TileState.IDLE) {
      return;
    }
    this.state = TileState.LOADING;

    const tile = this.tile;
    const tileState = tile.getState();
    if (tileState === TileState.LOADED) {
      this.apply_();
      return;
    }
    if (tileState === TileState.ERROR || tileState === TileState.EMPTY) {
      this.setState(tileState);
      return;
    }

    this.tileListenerKey_ = listen(tile, EventType.CHANGE, () => {
      const state = tile.getState();
      if (state === TileState.LOADED) {
        this.stopListening_();
        this.apply_();
      } else if (state === TileState.ERROR || state === TileState.EMPTY) {
        this.stopListening_();
        this.setState(state);
      }
    });
    tile.load();
  }

  /**
   * @private
   */
  closeImage_() {
    if (this.ownsImage_ && this.image_ instanceof ImageBitmap) {
      this.image_.close();
    }
    this.image_ = null;
    this.ownsImage_ = false;
  }

  /**
   * @private
   */
  cancelJob_() {
    // cleared first, so that the callback can tell a job we gave up on from one the pool
    // abandoned when it was rebuilt
    const job = this.job_;
    this.job_ = null;
    if (job) {
      this.styleProcessor_?.cancel(job);
    }
  }

  /**
   * @private
   */
  stopListening_() {
    if (this.tileListenerKey_) {
      unlistenByKey(this.tileListenerKey_);
      this.tileListenerKey_ = null;
    }
  }

  /**
   * Turn the loaded data into something drawable.
   * @private
   */
  apply_() {
    const data = this.tile.getData();
    if (!data) {
      this.setState(TileState.ERROR);
      return;
    }

    const options = this.options_;
    const styling = !!options.style;

    const image = asImageLike(data);
    if (image && !styling) {
      this.setImage_(image, false);
      return;
    }

    /**
     * @type {import("../size.js").Size}
     */
    let size;
    if (image) {
      // four bands of rgba, the way a shader reads an image texture
      if (!this.values_) {
        try {
          this.values_ = toArray(image);
        } catch (error) {
          // a cross-origin image without CORS headers cannot be read back
          this.setError_(/** @type {Error} */ (error).message);
          return;
        }
      }
      size = [image.width, image.height];
    } else {
      const arrayData = asArrayLike(data);
      if (!arrayData) {
        this.setState(TileState.ERROR);
        return;
      }
      // cpu.js indexes the data numerically, which a DataView does not support.
      this.values_ =
        arrayData instanceof DataView
          ? new Uint8Array(
              arrayData.buffer,
              arrayData.byteOffset,
              arrayData.byteLength,
            )
          : arrayData;
      size = this.getPixelSize_();
    }
    const values = this.values_;

    if (!styling) {
      this.setImageData_(toImageData(values, size, getBandCount(values, size)));
      return;
    }

    const bandCount = getBandCount(values, size);
    /** @type {string|null} */
    let handler;
    try {
      // the style is compiled into the worker, so the job only has to name it
      handler = ensureHandler(
        /** @type {string} */ (options.styleId),
        /** @type {import('../style/raster.js').RasterStyle} */ (options.style),
        bandCount,
        options.nodataBandIndex,
      );
    } catch (error) {
      // the style was compiled when it was set, so this only happens for a band layout it
      // was not validated against
      this.setError_(/** @type {Error} */ (error).message);
      return;
    }
    if (!handler) {
      // the style this was asked for has been replaced, so there is nothing worth styling
      // until `restyle` brings the one that replaced it
      return;
    }
    this.styleProcessor_ = getStyleProcessor();

    this.job_ = this.styleProcessor_.postJob(
      [
        {
          styleId: handler,
          data: values,
          size: size,
          variables: options.variables,
          resolution: options.resolution,
        },
      ],
      [undefined],
      (replies) => {
        const abandoned = this.job_ !== null;
        this.job_ = null;
        if (!replies) {
          // A pool is replaced when the set of styles it serves changes, and abandons what it
          // was running.  `cancelJob_` clears `job_` first, so anything still set here is work
          // we still want: ask the new pool for it.
          if (abandoned && !this.disposed) {
            this.apply_();
          }
          return;
        }
        const reply = /** @type {{bitmap: ImageBitmap, error: string}} */ (
          replies[0]
        );
        if (reply.error) {
          this.setError_(reply.error);
          return;
        }
        this.setImage_(reply.bitmap, true);
      },
    );
  }

  /**
   * @param {ImageData} imageData The rendered pixels.
   * @private
   */
  setImageData_(imageData) {
    createImageBitmap(imageData).then(
      (bitmap) => this.setImage_(bitmap, true),
      (error) => this.setError_(error.message),
    );
  }

  /**
   * @param {import("../DataTile.js").ImageLike} image The drawable pixels.
   * @param {boolean} owned Whether these pixels were made here, and so have to be closed
   * here.  Pixels passed through from the tile belong to the tile.
   * @private
   */
  setImage_(image, owned) {
    if (this.disposed) {
      // the tile went away while the pixels were on their way here
      if (owned && image instanceof ImageBitmap) {
        image.close();
      }
      return;
    }
    this.closeImage_();
    this.image_ = image;
    this.ownsImage_ = owned;
    this.setState(TileState.LOADED);
  }

  /**
   * Give up on the tile.  It counts as settled so that rendering does not wait on it
   * forever; its image stays null.
   * @param {string} message The error message.
   * @private
   */
  setError_(message) {
    logError(`Failed to style tile ${this.tileCoord}: ${message}`);
    this.setState(TileState.ERROR);
  }

  /**
   * @override
   */
  disposeInternal() {
    this.stopListening_();
    this.cancelJob_();
    this.closeImage_();
    super.disposeInternal();
  }
}

export default StyledTile;
