/**
 * @module ol/layer/Tile
 */
import CanvasTileLayerRenderer from '../renderer/canvas/TileLayer.js';
import {validateStyle} from '../style/raster.js';
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
 * image data is read as four bands of rgba.  A style that reads bands at an offset
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
     * @type {import("../style/raster.js").RasterStyleVariables}
     * @private
     */
    this.styleVariables_ = {};

    /**
     * The variables the style reads.
     * @type {Set<string>}
     * @private
     */
    this.styleVariableNames_ = new Set();

    /**
     * Bumped when the style itself is replaced.  Style variables do not affect it, because a
     * compiled form of the style stays valid when only its variables change.
     * @type {number}
     * @private
     */
    this.styleRevision_ = 0;

    /**
     * Bumped whenever the pixels a tile would render change, so that pixels made before are
     * known to be out of date.  A new style changes them, and so do new variables.
     * @type {number}
     * @private
     */
    this.renderRevision_ = 0;

    /**
     * Whether the style reads `['resolution']`, and so has to be applied again when the
     * resolution it was applied at is no longer the one being rendered.
     * @type {boolean}
     * @private
     */
    this.styleUsesResolution_ = false;

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
   * @return {import("../style/raster.js").RasterStyleVariables} The current style variables.
   */
  getStyleVariables() {
    return this.styleVariables_;
  }

  /**
   * The style variables to apply the style with.  They are read when a tile is styled
   * rather than when they are set, so a style can be given an object that is filled in
   * afterwards.
   * @return {import("../style/raster.js").RasterStyleVariables} The variables to render with.
   */
  getRenderVariables() {
    const variables = this.styleVariables_;
    for (const name of this.styleVariableNames_) {
      if (!(name in variables)) {
        throw new Error(`Missing '${name}' in style variables`);
      }
    }
    return variables;
  }

  /**
   * The revision of the style itself, which only {@link setStyle} changes.  Anything compiled
   * from the style can be keyed on this and survive a variables update.
   * @return {number} The style revision.
   */
  getStyleRevision() {
    return this.styleRevision_;
  }

  /**
   * Whether the style reads `['resolution']`.
   * @return {boolean} The style depends on the resolution.
   */
  getStyleUsesResolution() {
    return this.styleUsesResolution_;
  }

  /**
   * The revision of the rendered result, which both {@link setStyle} and
   * {@link updateStyleVariables} change.  Pixels made at an earlier revision are out of date.
   * @return {number} The render revision.
   */
  getRenderRevision() {
    return this.renderRevision_;
  }

  /**
   * Set the raster style.  Note that this replaces any previously set style variables, so
   * the new style also needs to include them, if needed.
   * @param {import("../style/raster.js").RasterStyle} style The new style.
   * @api
   */
  setStyle(style) {
    const requirements = validateStyle(style);
    this.styleUsesResolution_ = requirements.usesResolution;
    this.styleVariableNames_ = requirements.variables;
    this.style_ = style;
    this.styleVariables_ = style.variables || {};
    ++this.styleRevision_;
    ++this.renderRevision_;
    this.changed();
  }

  /**
   * Update any variables used by the raster style and trigger a re-render.
   * @param {import("../style/raster.js").RasterStyleVariables} variables Variables to update.
   * @api
   */
  updateStyleVariables(variables) {
    Object.assign(this.styleVariables_, variables);
    ++this.renderRevision_;
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
