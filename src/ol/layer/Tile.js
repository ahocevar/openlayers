/**
 * @module ol/layer/Tile
 */
import {validateStyle} from '../raster/style.js';
import CanvasTileLayerRenderer from '../renderer/canvas/TileLayer.js';
import BaseTileLayer from './BaseTile.js';

/**
 * @template {import("../source/Tile.js").default} TileSourceType
 * @typedef {import("./BaseTile.js").Options<TileSourceType> & {style?: import("../style/raster.js").RasterStyle}} Options
 */

/**
 * @classdesc
 * For layer sources that provide pre-rendered, tiled images in grids that are
 * organized by zoom levels for specific resolutions.
 * Note that any property set in the options is set as a {@link module:ol/Object~BaseObject}
 * property on the layer object; for example, setting `title: 'My Title'` in the
 * options means that `title` is observable, and has get/set accessors.
 *
 * A {@link module:ol/style/raster~RasterStyle style} can be applied to any
 * {@link module:ol/source/DataTile~DataTileSource}, including
 * {@link module:ol/source/GeoTIFF~GeoTIFFSource} and
 * {@link module:ol/source/ImageTile~ImageTileSource}.  Array data is read band by band;
 * image data is read as four bands of rgba, as the WebGL renderer reads it.  A style that
 * reads bands at an offset
 * (e.g. `['band', b, dx, dy]`) reads across tile boundaries, so such a style works best with
 * a source `gutter` to be correct at the edges.
 *
 * The style is applied to the tile's own data pixels. Scaled tiles are resampled by the browser's
 * Canvas2D implementation, similar to bilinear resampling. With `interpolate: false` on the source,
 * nearest neighbor resampling is used.
 *
 * @template {import("../source/Tile.js").default} [TileSourceType=import("../source/Tile.js").default]
 * @extends BaseTileLayer<TileSourceType, CanvasTileLayerRenderer>
 * @api
 */
class TileLayer extends BaseTileLayer {
  /**
   * @param {Options<TileSourceType>} [options] Tile layer options.
   */
  constructor(options) {
    options = options ? Object.assign({}, options) : {};
    const style = options.style;
    delete options.style;

    super(options);

    /**
     * @type {import("../style/raster.js").RasterStyle|null}
     * @private
     */
    this.style_ = null;

    /**
     * @type {Object<string, (string|number)>}
     * @private
     */
    this.styleVariables_ = {};

    /**
     * Bumped whenever the style or its variables change, so that pixels made with the
     * previous style are known to be out of date.
     * @type {number}
     * @private
     */
    this.styleRevision_ = 0;

    if (style) {
      this.setStyle(style);
    }
  }

  /**
   * @return {import("../style/raster.js").RasterStyle|null} The raster style, if any.
   */
  getStyle() {
    return this.style_;
  }

  /**
   * @return {Object<string, (string|number)>} The current style variables.
   */
  getStyleVariables() {
    return this.styleVariables_;
  }

  /**
   * @return {number} The style revision.
   */
  getStyleRevision() {
    return this.styleRevision_;
  }

  /**
   * Set the raster style.  Note that this replaces any previously set style variables, so
   * the new style also needs to include them, if needed.
   * @param {import("../style/raster.js").RasterStyle} style The new style.
   * @api
   */
  setStyle(style) {
    validateStyle(style);
    this.style_ = style;
    this.styleVariables_ = style.variables || {};
    ++this.styleRevision_;
    this.changed();
  }

  /**
   * Update any variables used by the raster style and trigger a re-render.
   * @param {Object<string, number>} variables Variables to update.
   * @api
   */
  updateStyleVariables(variables) {
    Object.assign(this.styleVariables_, variables);
    ++this.styleRevision_;
    this.changed();
  }

  /**
   * @override
   */
  createRenderer() {
    return new CanvasTileLayerRenderer(this, {
      cacheSize: this.getCacheSize(),
    });
  }
}

export default TileLayer;
