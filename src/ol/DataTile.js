/**
 * @module ol/DataTile
 */
import Tile from './Tile.js';
import TileState from './TileState.js';
import {createCanvasContext2D} from './dom.js';

/**
 * @typedef {HTMLImageElement|HTMLCanvasElement|OffscreenCanvas|HTMLVideoElement|ImageBitmap} ImageLike
 */

/**
 * @typedef {Uint8Array|Uint8ClampedArray|Float32Array|DataView} ArrayLike
 */

/**
 * Data that can be used with a DataTile.
 * @typedef {ArrayLike|ImageLike} Data
 */

/**
 * @param {Data} data Tile data.
 * @return {ImageLike|null} The image-like data.
 */
export function asImageLike(data) {
  return data instanceof Image ||
    data instanceof HTMLCanvasElement ||
    data instanceof HTMLVideoElement ||
    data instanceof ImageBitmap
    ? data
    : null;
}

/**
 * @param {Data} data Tile data.
 * @return {ArrayLike|null} The array-like data.
 */
export function asArrayLike(data) {
  return data instanceof Uint8Array ||
    data instanceof Uint8ClampedArray ||
    data instanceof Float32Array ||
    data instanceof DataView
    ? data
    : null;
}

/**
 * This is set as the cancellation reason when a tile is disposed.
 */
export const disposedError = new Error('disposed');

/**
 * @type {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null}
 */
let sharedContext = null;

/**
 * @param {ImageLike} image The image.
 * @return {Uint8ClampedArray} The data.
 */
export function toArray(image) {
  if (!sharedContext) {
    sharedContext = createCanvasContext2D(
      image.width,
      image.height,
      undefined,
      {willReadFrequently: true},
    );
  }
  const canvas = sharedContext.canvas;
  const width = image.width;
  if (canvas.width !== width) {
    canvas.width = width;
  }
  const height = image.height;
  if (canvas.height !== height) {
    canvas.height = height;
  }
  sharedContext.clearRect(0, 0, width, height);
  sharedContext.drawImage(image, 0, 0);
  return sharedContext.getImageData(0, 0, width, height).data;
}

/**
 * Determine how many bands per pixel a chunk of tile data holds.
 * @param {ArrayLike} data The tile data.
 * @param {import('./size.js').Size} size The pixel size of the data, gutter included.
 * @return {number} The number of bands per pixel.
 */
export function getBandCount(data, size) {
  const bytesPerElement = data instanceof Float32Array ? 4 : 1;
  const bytesPerRow = data.byteLength / size[1];
  return Math.floor(bytesPerRow / bytesPerElement / size[0]);
}

/**
 * Expand array tile data into RGBA image data.
 *
 * Bands are mapped the way {@link module:ol/webgl/TileTexture} maps them onto texture
 * formats: one band is luminance, two are luminance and alpha, three are RGB, and four or
 * more are RGBA taken from the first four bands.  `Float32Array` values are treated as
 * 0 to 1, as they are in a float texture; integer values are used as they are.
 *
 * @param {ArrayLike} data The tile data.
 * @param {import('./size.js').Size} size The pixel size of the data, gutter included.
 * @param {number} bandCount The number of bands per pixel.
 * @return {ImageData} The image data.
 */
export function toImageData(data, size, bandCount) {
  const width = size[0];
  const height = size[1];
  const pixelCount = width * height;

  let values;
  let scale;
  if (data instanceof Float32Array) {
    values = data;
    scale = 255;
  } else {
    values =
      data instanceof DataView
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : data;
    scale = 1;
  }

  if (
    bandCount === 4 &&
    values instanceof Uint8ClampedArray &&
    values.length === pixelCount * 4
  ) {
    // already in the target layout, and the caller draws the result straight away, so
    // sharing the tile's buffer is safe
    return new ImageData(
      /** @type {Uint8ClampedArray<ArrayBuffer>} */ (/** @type {*} */ (values)),
      width,
      height,
    );
  }

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0, offset = 0, target = 0; i < pixelCount; ++i) {
    switch (bandCount) {
      case 1: {
        const value = values[offset] * scale;
        rgba[target] = value;
        rgba[target + 1] = value;
        rgba[target + 2] = value;
        rgba[target + 3] = 255;
        break;
      }
      case 2: {
        const value = values[offset] * scale;
        rgba[target] = value;
        rgba[target + 1] = value;
        rgba[target + 2] = value;
        rgba[target + 3] = values[offset + 1] * scale;
        break;
      }
      case 3: {
        rgba[target] = values[offset] * scale;
        rgba[target + 1] = values[offset + 1] * scale;
        rgba[target + 2] = values[offset + 2] * scale;
        rgba[target + 3] = 255;
        break;
      }
      default: {
        rgba[target] = values[offset] * scale;
        rgba[target + 1] = values[offset + 1] * scale;
        rgba[target + 2] = values[offset + 2] * scale;
        rgba[target + 3] = values[offset + 3] * scale;
        break;
      }
    }
    offset += bandCount;
    target += 4;
  }
  return new ImageData(rgba, width, height);
}

/**
 * @type {import('./size.js').Size}
 */
const defaultSize = [256, 256];

/**
 * @typedef {Object} Options
 * @property {import("./tilecoord.js").TileCoord} tileCoord Tile coordinate.
 * @property {function(): Promise<Data>} loader Data loader.  For loaders that generate images,
 * the promise should not resolve until the image is loaded.
 * @property {number} [transition=250] A duration for tile opacity
 * transitions in milliseconds. A duration of 0 disables the opacity transition.
 * @property {boolean} [interpolate=false] Use interpolated values when resampling.  By default,
 * the nearest neighbor is used when resampling.
 * @property {import('./size.js').Size} [size=[256, 256]] Tile size.
 * @property {AbortController} [controller] An abort controller.
 * @api
 */

class DataTile extends Tile {
  /**
   * @param {Options} options Tile options.
   */
  constructor(options) {
    const state = TileState.IDLE;

    super(options.tileCoord, state, {
      transition: options.transition,
      interpolate: options.interpolate,
    });

    /**
     * @type {function(): Promise<Data>}
     * @private
     */
    this.loader_ = options.loader;

    /**
     * @type {Data|null}
     * @private
     */
    this.data_ = null;

    /**
     * @type {Error|null}
     * @private
     */
    this.error_ = null;

    /**
     * @type {import('./size.js').Size|null}
     * @private
     */
    this.size_ = options.size || null;

    /**
     * @type {AbortController|null}
     * @private
     */
    this.controller_ = options.controller || null;
  }

  /**
   * Get the tile size.
   * @return {import('./size.js').Size} Tile size.
   */
  getSize() {
    if (this.size_) {
      return this.size_;
    }
    const imageData = asImageLike(/** @type {Data} */ (this.data_));
    if (imageData) {
      return [imageData.width, imageData.height];
    }
    return defaultSize;
  }

  /**
   * Get the data for the tile.
   * @return {Data|null} Tile data.
   * @api
   */
  getData() {
    return this.data_;
  }

  /**
   * Get any loading error.
   * @return {Error|null} Loading error.
   * @api
   */
  getError() {
    return this.error_;
  }

  /**
   * Load the tile data.
   * @api
   * @override
   */
  load() {
    if (this.state !== TileState.IDLE && this.state !== TileState.ERROR) {
      return;
    }
    this.state = TileState.LOADING;
    this.changed();

    const self = this;
    this.loader_()
      .then(function (data) {
        self.data_ = data;
        self.state = TileState.LOADED;
        self.changed();
      })
      .catch(function (error) {
        self.error_ = error;
        self.state = TileState.ERROR;
        self.changed();
      });
  }

  /**
   * Clean up.
   * @override
   */
  disposeInternal() {
    if (this.controller_) {
      this.controller_.abort(disposedError);
      this.controller_ = null;
    }
    super.disposeInternal();
  }
}

export default DataTile;
