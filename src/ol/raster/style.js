/**
 * @module ol/raster/style
 */
import {ColorType, isType, newParsingContext} from '../expr/expression.js';
import {compileStyleToSource} from './pipeline.js';

/**
 * What a style needs from whoever renders it, learned by compiling it.
 *
 * @typedef {Object} StyleRequirements
 * @property {boolean} usesResolution The style reads the map state, which for a raster style
 * means `['resolution']`.  Pixels made for one resolution are stale at another, so a style that
 * does not read it never has to be applied again when the view changes.
 * @property {Set<string>} variables The variables the style reads.  Values for these are only
 * needed by the time the style is applied, not when it is set — the same as for
 * {@link module:ol/layer/WebGLTile~WebGLTileLayer}, which builds its shaders on the first
 * render, so a style can be set with an object that is filled in afterwards.
 * @property {Set<string>} colorVariables The subset of `variables` used as colors.  Their values
 * have to reach the compiled style as rgba arrays, because resolving a css color needs
 * {@link module:ol/color}, which a worker built from source cannot import.
 */

/**
 * Compile a style so that a malformed one throws where it was set, instead of failing
 * later on a worker where nothing is watching.  The compiled source is discarded; the
 * worker compiles its own, from the same code.  Compiling is also what records the variables
 * and the map state the style refers to.
 *
 * @param {import("../style/raster.js").RasterStyle} style The style.
 * @param {number} [bandCount] The number of bands the style will be applied to.
 * @return {StyleRequirements} What the style needs to be rendered.
 */
export function validateStyle(style, bandCount) {
  const context = newParsingContext();
  // the band count only decides how bands map onto channels, never whether a style can be
  // compiled, so validating with a guess is enough
  compileStyleToSource(
    style,
    bandCount === undefined ? 4 : bandCount,
    undefined,
    context,
  );

  /** @type {Set<string>} */
  const variables = new Set();
  /** @type {Set<string>} */
  const colorVariables = new Set();
  for (const [name, type] of context.variables) {
    variables.add(name);
    if (isType(type, ColorType)) {
      colorVariables.add(name);
    }
  }

  return {
    usesResolution: context.mapState,
    variables: variables,
    colorVariables: colorVariables,
  };
}
