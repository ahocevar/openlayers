import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import DataTile from '../../../../src/ol/source/DataTile.js';

const size = 256;
const half = 20037508.342789244;

/**
 * One band, as a checkerboard, so that any resampling shows up as a blend.
 * @return {Uint8Array} The tile data.
 */
function checkerboard() {
  const data = new Uint8Array(size * size);
  for (let row = 0; row < size; ++row) {
    for (let col = 0; col < size; ++col) {
      data[row * size + col] =
        (Math.floor(row / 8) + Math.floor(col / 8)) % 2 === 0 ? 0 : 255;
    }
  }
  return data;
}

/**
 * Three bands, as ramps in two directions.
 * @return {Uint8Array} The tile data.
 */
function ramps() {
  const data = new Uint8Array(size * size * 3);
  for (let row = 0; row < size; ++row) {
    for (let col = 0; col < size; ++col) {
      const offset = (row * size + col) * 3;
      data[offset] = col;
      data[offset + 1] = row;
      data[offset + 2] = 128;
    }
  }
  return data;
}

/**
 * @param {number} bandCount Bands per pixel.
 * @param {function(): Uint8Array} loader The data loader.
 * @param {import('../../../../src/ol/extent.js').Extent} extent The layer extent.
 * @return {TileLayer} The layer.
 */
function createLayer(bandCount, loader, extent) {
  return new TileLayer({
    extent: extent,
    source: new DataTile({
      bandCount: bandCount,
      tileSize: size,
      maxZoom: 0,
      transition: 0,
      interpolate: false,
      loader: loader,
    }),
  });
}

new Map({
  target: 'map',
  layers: [
    createLayer(1, checkerboard, [-half, -half, 0, half]),
    createLayer(3, ramps, [0, -half, half, half]),
  ],
  view: new View({center: [0, 0], zoom: 0}),
});

render({
  message: 'one band renders as luminance, three as rgb',
});
