import {assert} from 'chai';
import OLMap from '../../../../../../src/ol/Map.js';
import View from '../../../../../../src/ol/View.js';
import TileLayer from '../../../../../../src/ol/layer/Tile.js';
import WebGLTileLayer from '../../../../../../src/ol/layer/WebGLTile.js';
import DataTileSource from '../../../../../../src/ol/source/DataTile.js';

const SIZE = 256;

/**
 * A ramp, so that every part of the color expression is exercised.
 */
const style = {
  color: [
    'interpolate',
    ['linear'],
    ['band', 1],
    0,
    [255, 0, 0],
    1,
    [0, 0, 255],
  ],
};

/**
 * @param {function(number, number): number} value Band value for a column and row.
 * @return {DataTileSource} A single tile source, one data pixel per screen pixel at zoom 0.
 */
function createSource(value) {
  return new DataTileSource({
    bandCount: 1,
    maxZoom: 0,
    transition: 0,
    interpolate: false,
    loader: function () {
      const data = new Uint8Array(SIZE * SIZE);
      for (let row = 0; row < SIZE; ++row) {
        for (let col = 0; col < SIZE; ++col) {
          data[row * SIZE + col] = value(col, row);
        }
      }
      return data;
    },
  });
}

/**
 * @param {import('../../../../../../src/ol/layer/Layer.js').default} layer The layer.
 * @return {Promise<Uint8ClampedArray>} The rendered pixels.
 */
function render(layer) {
  const map = new OLMap({
    target: createMapDiv(SIZE, SIZE),
    layers: [layer],
    view: new View({center: [0, 0], zoom: 0}),
  });
  return new Promise((resolve) => {
    map.once('rendercomplete', () => {
      setTimeout(() => {
        const canvas = map.getViewport().querySelector('canvas');
        const scratch = document.createElement('canvas');
        scratch.width = SIZE;
        scratch.height = SIZE;
        const context = scratch.getContext('2d', {willReadFrequently: true});
        context.drawImage(canvas, 0, 0);
        const data = context.getImageData(0, 0, SIZE, SIZE).data;
        disposeMap(map);
        resolve(data);
      }, 0);
    });
  });
}

describe('raster style parity', function () {
  it('colors each data pixel, without resampling, at 1:1', async () => {
    const data = await render(
      new TileLayer({
        style: style,
        source: createSource((col, row) => ((row + col) % 2 === 0 ? 0 : 255)),
      }),
    );

    // A checkerboard of the two ramp ends.  Any resampling would blend them into
    // intermediate colors, so the tile data reaching the canvas untouched is what
    // this asserts.
    const counts = {};
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    assert.deepEqual(counts, {
      '255,0,0': (SIZE * SIZE) / 2,
      '0,0,255': (SIZE * SIZE) / 2,
    });
  });

  it('matches the WebGL renderer pixel for pixel at 1:1', async () => {
    const value = (col, row) => (row * SIZE + col) % 256;
    const canvasData = await render(
      new TileLayer({style: style, source: createSource(value)}),
    );
    const webglData = await render(
      new WebGLTileLayer({style: style, source: createSource(value)}),
    );

    let worst = 0;
    for (let i = 0; i < canvasData.length; i += 4) {
      for (let band = 0; band < 3; ++band) {
        worst = Math.max(
          worst,
          Math.abs(canvasData[i + band] - webglData[i + band]),
        );
      }
    }
    assert.strictEqual(worst, 0);
  });
});
