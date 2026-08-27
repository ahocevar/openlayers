import {assert} from 'chai';
import {describe, it} from 'vitest';
import {
  compileStyleToFunction,
  compileStyleToSource,
} from '../../../../src/ol/raster/pipeline.js';
import {buildWorkerSource} from '../../../../src/ol/raster/workerSource.js';

const size = [8, 8];

/**
 * @param {number} bandCount Bands per pixel.
 * @return {Float32Array} Tile data.
 */
function makeData(bandCount) {
  const data = new Float32Array(size[0] * size[1] * bandCount);
  for (let i = 0; i < data.length; ++i) {
    data[i] = (i * 37) % 3001;
  }
  return data;
}

const first = {
  variables: {max: 3000},
  color: [
    'interpolate',
    ['linear'],
    ['/', ['band', 1], ['var', 'max']],
    0,
    [0, 0, 0],
    1,
    [255, 255, 255],
  ],
};

const second = {
  color: ['palette', ['/', ['band', 1], 600], ['#0d0887', '#f0f921']],
};

describe('ol/raster/workerSource.js', () => {
  describe('buildWorkerSource()', () => {
    /**
     * Run the generated worker's handler table without a worker, by evaluating the source with
     * a stub for the part that talks to the outside.
     * @param {Object<string, string>} handlers Render source by style id.
     * @return {Object<string, Function>} The handler table.
     */
    function handlerTable(handlers) {
      const source = buildWorkerSource(handlers);
      // the glue installs an onmessage handler on `self`; give it somewhere to put it
      return new Function('self', `${source}\nreturn handlers;`)({});
    }

    it('serves several styles from one table, keyed by style id', () => {
      const handlers = handlerTable({
        'layer-1/1': compileStyleToSource(first, 1, undefined),
        'layer-2/1': compileStyleToSource(second, 1, undefined),
      });
      assert.deepEqual(Object.keys(handlers), ['layer-1/1', 'layer-2/1']);
    });

    it('bakes in a style without changing what it renders', () => {
      const data = makeData(1);
      const handlers = handlerTable({
        'layer-1/1': compileStyleToSource(first, 1, undefined),
        'layer-2/1': compileStyleToSource(second, 1, undefined),
      });

      for (const [styleId, style] of [
        ['layer-1/1', first],
        ['layer-2/1', second],
      ]) {
        const variables = style.variables || {};
        const expected = compileStyleToFunction(style, 1, undefined)(
          data,
          size,
          1,
          variables,
        );

        const actual = handlers[styleId](data, size, 1, variables);
        assert.deepEqual(
          Array.from(actual),
          Array.from(expected),
          `${styleId} should match`,
        );
      }
    });

    it('names the style a job asks for when it is not registered', () => {
      const source = buildWorkerSource({});
      assert.include(source, 'No style registered for');
    });
  });
});
