/**
 * @module ol/raster/StyledTile
 */
import {getBandCount, toImageData} from '../DataTile.js';
import EventType from '../events/EventType.js';
import EventTarget from '../events/Target.js';

/**
 * @classdesc
 * A tile's data expanded into something the canvas renderer can draw.  Without a style
 * that is a straight band-to-RGBA conversion; with one it is a job on a worker pool.
 * Either way the result arrives later, because the pixels become an `ImageBitmap`, and
 * listeners are told with a `change` event.
 *
 * This is the canvas counterpart of {@link module:ol/webgl/BaseTileRepresentation}.
 */
class StyledTile extends EventTarget {
  /**
   * @param {import("../DataTile.js").default} tile The tile.
   * @param {import("../size.js").Size} pixelSize The pixel size of the tile data, gutter included.
   * @param {number} revision The style revision this was made for.
   */
  constructor(tile, pixelSize, revision) {
    super();

    /**
     * @type {import("../DataTile.js").default}
     */
    this.tile = tile;

    /**
     * @type {import("../size.js").Size}
     */
    this.pixelSize = pixelSize;

    /**
     * The style revision this represents.  A newer revision needs a new instance.
     * @type {number}
     */
    this.revision = revision;

    /**
     * Whether there is nothing left to wait for.  A tile that failed is ready too, so
     * that rendering does not wait on it forever; its image is null.
     * @type {boolean}
     */
    this.ready = false;

    /**
     * @type {ImageBitmap|null}
     */
    this.image = null;

    /**
     * @type {string|null}
     */
    this.error = null;

    /**
     * @type {import("../Processor.js").Job|null}
     * @private
     */
    this.job_ = null;

    /**
     * @type {import("../Processor.js").default|null}
     * @private
     */
    this.processor_ = null;
  }

  /**
   * Expand the tile's bands to RGBA, without applying a style.
   * @param {Uint8Array|Uint8ClampedArray|Float32Array} data The tile data.
   */
  convert(data) {
    const size = this.pixelSize;
    this.setImageData_(toImageData(data, size, getBandCount(data, size)));
  }

  /**
   * Apply a raster style to the tile data on a worker.
   * @param {import("../Processor.js").default} processor The worker pool.
   * @param {Object} message The job message.
   */
  style(processor, message) {
    this.processor_ = processor;
    this.job_ = processor.postJob([message], [undefined], (replies) => {
      this.job_ = null;
      if (!replies) {
        // Cancelled, or dropped from the queue.  A newer representation has taken over.
        return;
      }
      const reply = /** @type {{bitmap: ImageBitmap, error: string}} */ (
        replies[0]
      );
      if (reply.error) {
        this.setError_(reply.error);
        return;
      }
      this.setImage_(reply.bitmap);
    });
  }

  /**
   * @param {ImageData} imageData The rendered pixels.
   * @private
   */
  setImageData_(imageData) {
    createImageBitmap(imageData).then(
      (bitmap) => this.setImage_(bitmap),
      (error) => this.setError_(error.message),
    );
  }

  /**
   * @param {ImageBitmap} image The drawable pixels.
   * @private
   */
  setImage_(image) {
    if (this.disposed) {
      // The tile went away while the pixels were on their way here.
      image.close();
      return;
    }
    this.image = image;
    this.ready = true;
    this.dispatchEvent(EventType.CHANGE);
  }

  /**
   * Give up on the tile.  It counts as ready so that rendering does not wait on it
   * forever; its image stays null.
   * @param {string} message The error message.
   * @private
   */
  setError_(message) {
    this.error = message;
    this.ready = true;
    this.dispatchEvent(EventType.CHANGE);
  }

  /**
   * @override
   */
  disposeInternal() {
    if (this.job_ && this.processor_) {
      this.processor_.cancel(this.job_);
      this.job_ = null;
    }
    if (this.image) {
      this.image.close();
      this.image = null;
    }
    super.disposeInternal();
  }
}

export default StyledTile;
