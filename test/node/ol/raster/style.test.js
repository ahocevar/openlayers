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

    it('names the variables a style reads, from any style property', () => {
      // values are not needed yet, only by the time the style is applied
      const requirements = validateStyle({
        contrast: ['*', ['var', 'contrast'], 2],
        color: ['var', 'tint'],
      });
      assert.sameMembers(Array.from(requirements.variables), [
        'tint',
        'contrast',
      ]);
      assert.deepEqual(Array.from(requirements.colorVariables), ['tint']);
    });

    it('reports whether the style reads the resolution', () => {
      assert.isTrue(
        validateStyle({gamma: ['/', 1, ['resolution']]}).usesResolution,
      );
      assert.isFalse(validateStyle({}).usesResolution);
    });

    it('throws for a malformed expression', () => {
      assert.throws(() => validateStyle({color: ['band']}));
    });

    it('handles a style with nothing to validate', () => {
      validateStyle({});
    });
  });
});
