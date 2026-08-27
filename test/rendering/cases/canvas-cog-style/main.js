import Map from '../../../../src/ol/Map.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import GeoTIFF from '../../../../src/ol/source/GeoTIFF.js';

const source = new GeoTIFF({
  sources: [
    {
      url: '/data/raster/sentinel-b04.tif',
      min: 0,
      max: 10000,
    },
    {
      url: '/data/raster/sentinel-b08.tif',
      min: 0,
      max: 10000,
    },
  ],
  transition: 0,
});

// The same style as the cog-style case, on the canvas renderer.
const layer = new TileLayer({
  source: source,
  style: {
    color: [
      'interpolate',
      ['linear'],
      ['/', ['-', ['band', 2], ['band', 1]], ['+', ['band', 2], ['band', 1]]],
      -0.2,
      [200, 0, 0],
      1,
      [0, 255, 0],
    ],
  },
});

new Map({
  layers: [layer],
  target: 'map',
  view: source.getView(),
});

render({
  message: 'renders a raster style without webgl',
});
