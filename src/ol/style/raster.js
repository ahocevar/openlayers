/**
 * @module ol/style/raster
 */

/**
 * @api
 * @fileoverview Raster data can be styled with an object literal whose properties translate
 * band values into rendered pixels.  The same style object is understood by
 * {@link module:ol/layer/Tile~TileLayer} and {@link module:ol/layer/WebGLTile~WebGLTileLayer},
 * so a style can move between the two renderers unchanged.
 *
 * Band values are read with the `['band', bandIndex]` operator, where the index is 1-based.
 * Integer band values are normalized to the 0 to 1 range; floating point values are used as
 * they are.  For example, to render the first band of a single band source as a blue to white
 * gradient:
 *
 *     const style = {
 *       color: [
 *         'interpolate',
 *         ['linear'],
 *         ['band', 1],
 *         0, [0, 0, 128],
 *         1, [255, 255, 255],
 *       ],
 *     };
 *
 * Band expressions require a source that provides array data, such as
 * {@link module:ol/source/DataTile~DataTileSource} or {@link module:ol/source/GeoTIFF~GeoTIFFSource}.
 */

/**
 * Values for the `['var', 'varName']` operator.  A variable the style uses as a color holds a
 * css color string or an rgba array; any other variable holds a number or a string.
 *
 * @typedef {Object<string, (string|number|import("../color.js").Color)>} RasterStyleVariables
 * @api
 */

/**
 * Translates tile data to rendered pixels.
 *
 * @typedef {Object} RasterStyle
 * @property {RasterStyleVariables} [variables] Style variables.  These
 * variables can be used in the `color`, `brightness`, `contrast`, `exposure`, `saturation` and `gamma`
 * {@link import("../expr/expression.js").ExpressionValue expressions}, using the `['var', 'varName']` operator.
 * To update style variables, use the layer's `updateStyleVariables` method.
 * @property {import("../expr/expression.js").ExpressionValue} [color] An expression applied to color values.
 * @property {import("../expr/expression.js").ExpressionValue} [brightness=0] Value used to decrease or increase
 * the layer brightness.  Values range from -1 to 1.
 * @property {import("../expr/expression.js").ExpressionValue} [contrast=0] Value used to decrease or increase
 * the layer contrast.  Values range from -1 to 1.
 * @property {import("../expr/expression.js").ExpressionValue} [exposure=0] Value used to decrease or increase
 * the layer exposure.  Values range from -1 to 1.
 * @property {import("../expr/expression.js").ExpressionValue} [saturation=0] Value used to decrease or increase
 * the layer saturation.  Values range from -1 to 1.
 * @property {import("../expr/expression.js").ExpressionValue} [gamma=1] Apply a gamma correction to the layer.
 * Values range from 0 to infinity.
 * @api
 */

export default {};
