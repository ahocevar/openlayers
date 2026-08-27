import {assert} from 'chai';
import {describe, it} from 'vitest';
import {newRasterEvaluationContext} from '../../../../src/ol/expr/cpu.js';
import {
  compileStyle,
  compileStyleToFunction,
  compileStyleToSource,
  render as renderPipeline,
} from '../../../../src/ol/raster/pipeline.js';

/**
 * @typedef {Object} Options
 * @property {Float32Array} [data] The tile data, one pixel unless a size says otherwise.
 * @property {import('../../../../src/ol/size.js').Size} [size] The pixel size of the data.
 * @property {number} [bandScale] Multiplier applied to raw band values.
 * @property {number} [nodataBandIndex] The 1-based nodata band index.
 * @property {Object<string, *>} [variables] The style variables, when they are not the
 * style's own.
 * @property {number} [resolution] The view resolution.
 */

/**
 * Render a tile with the compiled style, and report the pixels as plain numbers.
 * @param {import('../../../../src/ol/style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {Options} options The tile and how to read it.
 * @return {Array<number>} Red, green, blue and alpha for every pixel, in the 0 to 255 range.
 */
function render(style, bandCount, options) {
  const compiled = compileStyleToFunction(
    style,
    bandCount,
    options.nodataBandIndex,
  );
  return Array.from(
    compiled(
      /** @type {Float32Array} */ (options.data),
      options.size || [1, 1],
      options.bandScale === undefined ? 1 : options.bandScale,
      options.variables || style.variables || {},
      options.resolution === undefined ? NaN : options.resolution,
    ),
  );
}

describe('ol/raster/pipeline.js', () => {
  describe('compileStyleToFunction()', () => {
    it('maps bands onto channels the way a texture does', () => {
      // one band is a gray value, a second is its alpha, and three or more are the channels
      assert.deepEqual(
        render({}, 1, {data: new Float32Array([0.4])}),
        [102, 102, 102, 255],
      );
      assert.deepEqual(
        render({}, 2, {data: new Float32Array([0.4, 0.6])}),
        [102, 102, 102, 153],
      );
      assert.deepEqual(
        render({}, 3, {data: new Float32Array([0.2, 0.4, 0.6])}),
        [51, 102, 153, 255],
      );
      assert.deepEqual(
        render({}, 4, {data: new Float32Array([0.2, 0.4, 0.6, 0.8])}),
        [51, 102, 153, 204],
      );
    });

    it('scales integer band values, the way an integer texture is sampled', () => {
      assert.deepEqual(
        render({}, 1, {data: new Float32Array([102]), bandScale: 1 / 255}),
        [102, 102, 102, 255],
      );
    });

    it('takes the alpha of a style without a color from the nodata band', () => {
      assert.deepEqual(
        render({}, 3, {
          data: new Float32Array([0.2, 0.4, 0.6]),
          nodataBandIndex: 3,
        }),
        [51, 102, 153, 153],
      );
    });

    it('discards the pixels the nodata band marks', () => {
      // the WebGL renderer discards the fragment; here that is a transparent pixel
      assert.deepEqual(
        render({color: ['color', 10, 20, 30]}, 1, {
          data: new Float32Array([0, 0.5]),
          size: [2, 1],
          nodataBandIndex: 1,
        }),
        [0, 0, 0, 0, 10, 20, 30, 255],
      );
    });

    it('leaves nothing of an earlier tile in an array it writes into again', () => {
      // the worker hands the same array to every job, so a discarded pixel has to be cleared
      const compiled = compileStyleToFunction(
        {color: ['color', 10, 20, 30]},
        1,
        1,
      );
      const out = new Uint8ClampedArray(8);
      compiled(new Float32Array([0.5, 0.5]), [2, 1], 1, {}, NaN, out);
      compiled(new Float32Array([0, 0.5]), [2, 1], 1, {}, NaN, out);
      assert.deepEqual(Array.from(out), [0, 0, 0, 0, 10, 20, 30, 255]);
    });

    it('applies contrast, exposure, gamma and brightness', () => {
      assert.deepEqual(
        render({contrast: 1}, 1, {data: new Float32Array([0.75])}),
        [255, 255, 255, 255],
      );
      assert.deepEqual(
        render({exposure: 1}, 1, {data: new Float32Array([0.2])}),
        [102, 102, 102, 255],
      );
      assert.deepEqual(
        render({gamma: 2}, 1, {data: new Float32Array([0.16])}),
        [102, 102, 102, 255],
      );
      assert.deepEqual(
        render({brightness: 0.1}, 1, {data: new Float32Array([0.5])}),
        [153, 153, 153, 255],
      );
    });

    it('desaturates towards the luminance the shader matrix uses', () => {
      // fully desaturated, every channel holds the red channel's share of the luminance
      assert.deepEqual(
        render({color: ['color', 255, 0, 0], saturation: -1}, 1, {
          data: new Float32Array([0]),
        }),
        [54, 54, 54, 255],
      );
    });

    it('evaluates an adjustment once for the whole tile', () => {
      let reads = 0;
      const variables = {};
      Object.defineProperty(variables, 'g', {
        get() {
          ++reads;
          return 2;
        },
        enumerable: true,
      });
      render({variables: {g: 2}, gamma: ['var', 'g']}, 1, {
        data: new Float32Array(8).fill(0.16),
        size: [4, 2],
        variables: variables,
      });
      assert.strictEqual(reads, 1);
    });

    it('gives the style the variables and the resolution', () => {
      assert.deepEqual(
        render(
          {
            variables: {v: 2},
            color: ['array', ['/', ['var', 'v'], ['resolution']], 0, 0, 1],
          },
          1,
          {data: new Float32Array([0]), resolution: 5},
        ),
        [102, 0, 0, 255],
      );
    });

    it('derives the pixel position for a style that reads a neighbour', () => {
      assert.deepEqual(
        render({color: ['array', ['band', 1, -1, 0], 0, 0, 1]}, 1, {
          data: new Float32Array([0, 0.4, 1]),
          size: [3, 1],
        }),
        // the first pixel clamps to itself, the others read the pixel to their left
        [0, 0, 0, 255, 0, 0, 0, 255, 102, 0, 0, 255],
      );
    });

    it('throws for an operator a raster style has no data for', () => {
      assert.throws(
        () =>
          compileStyleToFunction(
            {color: ['array', ['get', 'red'], 0, 0, 1]},
            1,
            undefined,
          ),
        /'get' operator reads feature data/,
      );
    });
  });

  describe('compileStyleToSource()', () => {
    const stops = [['band', 1], 0, [255, 0, 0, 1], 1, [0, 0, 255, 1]];

    it('carries the HCL helpers only for a style that mixes in HCL', () => {
      assert.notInclude(
        compileStyleToSource(
          {color: ['interpolate', ['linear'], ...stops]},
          1,
          undefined,
        ),
        'function mixHcl',
      );
      const source = compileStyleToSource(
        {color: ['interpolate-hcl', ['linear'], ...stops]},
        1,
        undefined,
      );
      assert.include(source, 'function mixHcl');
      // the helpers are shared by every pixel, so they are built outside the render function
      assert.isBelow(
        source.indexOf('function mixHcl'),
        source.indexOf('for ('),
      );
    });

    it('renders a style that mixes in HCL', () => {
      assert.deepEqual(
        render({color: ['interpolate-hcl', ['linear'], ...stops]}, 1, {
          data: new Float32Array([0]),
        }),
        [255, 0, 0, 255],
      );
    });
  });

  describe('render()', () => {
    /**
     * Render by walking the closure tree, the way the main thread fallback does.
     * @param {import('../../../../src/ol/style/raster.js').RasterStyle} style The style.
     * @param {number} bandCount The number of bands per pixel.
     * @param {Options} options The tile and how to read it.
     * @return {Array<number>} Red, green, blue and alpha for every pixel.
     */
    function interpret(style, bandCount, options) {
      const context = newRasterEvaluationContext();
      context.data = options.data;
      context.size = options.size || [1, 1];
      context.bandCount = bandCount;
      context.bandScale =
        options.bandScale === undefined ? 1 : options.bandScale;
      context.variables = options.variables || style.variables || {};
      context.resolution =
        options.resolution === undefined ? NaN : options.resolution;
      return Array.from(
        renderPipeline(
          compileStyle(style, bandCount, options.nodataBandIndex),
          context,
        ),
      );
    }

    it('renders what the emitted loop renders', () => {
      // the fallback has to agree with the worker, or a policy would change the map
      const style = {
        color: [
          'interpolate',
          ['linear'],
          ['band', 1],
          0,
          [255, 0, 0, 1],
          1,
          [0, 0, 255, 1],
        ],
        gamma: 1.5,
      };
      const options = {data: new Float32Array([0, 0.25, 0.5, 1]), size: [2, 2]};
      assert.deepEqual(interpret(style, 1, options), render(style, 1, options));
    });

    it('discards the pixels the emitted loop discards', () => {
      const options = {
        data: new Float32Array([0.5, 0, 0.5, 1]),
        size: [2, 1],
        nodataBandIndex: 2,
      };
      assert.deepEqual(interpret({}, 2, options), render({}, 2, options));
    });
  });
});
