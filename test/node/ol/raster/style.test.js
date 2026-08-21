import {assert} from 'chai';
import {describe, it} from 'vitest';
import {analyzeStyle} from '../../../../src/ol/raster/style.js';

describe('ol/raster/style.js', () => {
  describe('analyzeStyle()', () => {
    it('reports the bands a style reads', () => {
      const analysis = analyzeStyle({
        color: ['array', ['band', 3], ['band', 1], ['band', 2], 1],
      });
      assert.deepEqual(analysis.bands, [1, 2, 3]);
      assert.strictEqual(analysis.offsets, false);
    });

    it('reports no offsets for explicit zero offsets', () => {
      const analysis = analyzeStyle({color: ['band', 1, 0, 0]});
      assert.strictEqual(analysis.offsets, false);
    });

    it('reports offsets for a neighbour read', () => {
      const analysis = analyzeStyle({color: ['band', 1, -1, 0]});
      assert.strictEqual(analysis.offsets, true);
    });

    it('reports variables from every style property', () => {
      const analysis = analyzeStyle({
        color: ['palette', ['band', 1], ['red', 'blue']],
        gamma: ['var', 'gamma'],
        contrast: ['*', ['var', 'contrast'], 2],
      });
      assert.deepEqual(analysis.variables, ['contrast', 'gamma']);
      assert.deepEqual(analysis.bands, [1]);
    });

    it('handles a style with nothing to analyze', () => {
      const analysis = analyzeStyle({});
      assert.deepEqual(analysis.bands, []);
      assert.deepEqual(analysis.variables, []);
      assert.strictEqual(analysis.offsets, false);
    });
  });
});
