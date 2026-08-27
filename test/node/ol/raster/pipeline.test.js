import {assert} from 'chai';
import {describe, it} from 'vitest';
import {newRasterEvaluationContext} from '../../../../src/ol/expr/cpu.js';
import {
  compileStyle,
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
 * @property {Uint8ClampedArray} [out] An array to render into, instead of a new one.
 */

/**
 * Render a tile with the compiled style, and report the pixels as plain numbers.
 * @param {import('../../../../src/ol/style/raster.js').RasterStyle} style The style.
 * @param {number} bandCount The number of bands per pixel.
 * @param {Options} options The tile and how to read it.
 * @return {Array<number>} Red, green, blue and alpha for every pixel, in the 0 to 255 range.
 */
function render(style, bandCount, options) {
  const context = newRasterEvaluationContext();
  context.data = options.data;
  context.size = options.size || [1, 1];
  context.bandCount = bandCount;
  context.bandScale = options.bandScale === undefined ? 1 : options.bandScale;
  context.variables = options.variables || style.variables || {};
  context.resolution =
    options.resolution === undefined ? NaN : options.resolution;
  return Array.from(
    renderPipeline(
      compileStyle(style, bandCount, options.nodataBandIndex),
      context,
      options.out,
    ),
  );
}

describe('ol/raster/pipeline.js', () => {
  describe('render()', () => {
    it('maps bands onto channels', () => {
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

    it('scales integer band values', () => {
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
      const style = {color: ['color', 10, 20, 30]};
      const tile = {
        size: [2, 1],
        nodataBandIndex: 1,
        out: new Uint8ClampedArray(8),
      };
      render(style, 1, {...tile, data: new Float32Array([0.5, 0.5])});
      assert.deepEqual(
        render(style, 1, {...tile, data: new Float32Array([0, 0.5])}),
        [0, 0, 0, 0, 10, 20, 30, 255],
      );
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

    it('desaturates towards luminance', () => {
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
  });

  describe('compileStyle()', () => {
    it('throws for an operator a raster style has no data for', () => {
      assert.throws(
        () => compileStyle({color: ['array', ['get', 'red'], 0, 0, 1]}, 1),
        /Raster styles have no feature data to read/,
      );
    });
  });
});
