/**
 * @module ol/raster/style
 */
import {equivalent} from '../proj.js';
import {compileStyle} from './pipeline.js';

/**
 * @typedef {import("../source/DataTile.js").default<import("../DataTile.js").default|import("../ImageTile.js").default>} DataTileSourceType
 */

/**
 * Whether reprojecting the source to the given projection appends a coverage alpha band.
 * Only sources that do not already carry an alpha band get one, so a reprojected tile's
 * band layout can differ from its source's.  Both renderers must agree on this, or a style
 * reads the wrong band after reprojection.
 *
 * @param {DataTileSourceType} source The render source.
 * @param {import("../proj/Projection.js").default} [projection] The render projection.
 * @return {boolean} A coverage band is added.
 */
export function usesCoverageBand(source, projection) {
  if (!source || !projection || source.hasAlpha !== false) {
    return false;
  }
  const sourceProjection = source.getProjection();
  return !!sourceProjection && !equivalent(sourceProjection, projection);
}

/**
 * The number of bands a tile from this source has when rendered in the given projection.
 * @param {DataTileSourceType|null} source The render source.
 * @param {import("../proj/Projection.js").default} [projection] The render projection.
 * @return {number} The number of source bands.
 */
export function getSourceBandCount(source, projection) {
  const bandCount = source && 'bandCount' in source ? source.bandCount : 4;
  return usesCoverageBand(
    /** @type {DataTileSourceType} */ (source),
    projection,
  )
    ? bandCount + 1
    : bandCount;
}

/**
 * The 1-based index of the band that marks nodata, if there is one.
 * @param {DataTileSourceType|null} source The render source.
 * @param {import("../proj/Projection.js").default} [projection] The render projection.
 * @return {number|undefined} The nodata band index.
 */
export function getSourceNodataBandIndex(source, projection) {
  if (!source) {
    return undefined;
  }
  if (usesCoverageBand(source, projection)) {
    // The appended coverage band is the last (1-based) band.
    return source.bandCount + 1;
  }
  return 'nodataBandIndex' in source ? source.nodataBandIndex : undefined;
}

/**
 * What a style needs from the data it is applied to.
 *
 * @typedef {Object} StyleAnalysis
 * @property {Array<number>} bands The 1-based indices of the bands read with a literal index.
 * @property {boolean} offsets A band is read at a nonzero offset, making the style a
 * neighbourhood operation rather than a per-pixel one.
 * @property {Array<string>} variables The names of the style variables referenced.
 */

/**
 * Walk an encoded expression, recording what it reads.
 * @param {*} expression The encoded expression.
 * @param {{bands: Set<number>, offsets: boolean, variables: Set<string>}} result Accumulator.
 */
function walkExpression(expression, result) {
  if (!Array.isArray(expression)) {
    return;
  }
  const operator = expression[0];
  if (typeof operator === 'string' && expression.length > 1) {
    if (operator === 'band') {
      if (typeof expression[1] === 'number') {
        result.bands.add(expression[1]);
      }
      for (let i = 2, ii = expression.length; i < ii; ++i) {
        if (expression[i] !== 0) {
          result.offsets = true;
        }
      }
    } else if (operator === 'var' && typeof expression[1] === 'string') {
      result.variables.add(expression[1]);
    }
  }
  for (let i = 1, ii = expression.length; i < ii; ++i) {
    walkExpression(expression[i], result);
  }
}

/**
 * Inspect a raster style without parsing it, to decide how it has to be evaluated.
 * @param {import("../style/raster.js").RasterStyle} style The style.
 * @return {StyleAnalysis} What the style reads.
 */
export function analyzeStyle(style) {
  const result = {
    bands: new Set(),
    offsets: false,
    variables: new Set(),
  };
  walkExpression(style.color, result);
  walkExpression(style.brightness, result);
  walkExpression(style.contrast, result);
  walkExpression(style.exposure, result);
  walkExpression(style.saturation, result);
  walkExpression(style.gamma, result);
  return {
    bands: Array.from(result.bands).sort((a, b) => a - b),
    offsets: result.offsets,
    variables: Array.from(result.variables).sort(),
  };
}

/**
 * Compile a style so that a malformed one throws where it was set, instead of failing
 * later on a worker where nothing is watching.  The compiled result is discarded; the
 * worker compiles its own, from the same code.
 *
 * @param {import("../style/raster.js").RasterStyle} style The style.
 * @param {number} [bandCount] The number of bands the style will be applied to.
 */
export function validateStyle(style, bandCount) {
  compileStyle(style, bandCount === undefined ? 4 : bandCount, undefined);

  const variables = style.variables || {};
  for (const name of analyzeStyle(style).variables) {
    if (!(name in variables)) {
      throw new Error(`Missing '${name}' in style variables`);
    }
  }
}
