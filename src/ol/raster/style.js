/**
 * @module ol/raster/style
 */
import {newParsingContext} from '../expr/expression.js';
import {compileStyle} from './pipeline.js';

/**
 * Compile a style so that a malformed one throws where it was set, instead of failing
 * later on a worker where nothing is watching.  The compiled result is discarded; the
 * worker compiles its own, from the same code.
 *
 * @param {import("../style/raster.js").RasterStyle} style The style.
 * @param {number} [bandCount] The number of bands the style will be applied to.
 */
export function validateStyle(style, bandCount) {
  // compiling records the variables the style refers to
  const context = newParsingContext();
  compileStyle(
    style,
    bandCount === undefined ? 4 : bandCount,
    undefined,
    context,
  );

  const variables = style.variables || {};
  for (const name of context.variables.keys()) {
    if (!(name in variables)) {
      throw new Error(`Missing '${name}' in style variables`);
    }
  }
}
