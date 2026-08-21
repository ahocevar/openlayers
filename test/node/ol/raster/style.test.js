import {assert} from 'chai';
import {describe, it} from 'vitest';
import {validateStyle} from '../../../../src/ol/raster/style.js';

describe('ol/raster/style.js', () => {
  describe('validateStyle()', () => {
    it('accepts a style whose variables are all declared', () => {
      validateStyle({
        variables: {gamma: 1, contrast: 0},
        gamma: ['var', 'gamma'],
        contrast: ['*', ['var', 'contrast'], 2],
      });
    });

    it('names a variable that is missing, from any style property', () => {
      assert.throws(
        () => validateStyle({contrast: ['*', ['var', 'contrast'], 2]}),
        /Missing 'contrast' in style variables/,
      );
    });

    it('throws for a malformed expression', () => {
      assert.throws(() => validateStyle({color: ['band']}));
    });

    it('handles a style with nothing to validate', () => {
      validateStyle({});
    });
  });
});
