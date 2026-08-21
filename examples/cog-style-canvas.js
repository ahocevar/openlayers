import Map from '../src/ol/Map.js';
import TileLayer from '../src/ol/layer/Tile.js';
import GeoTIFF from '../src/ol/source/GeoTIFF.js';

const max = 3000;
function normalize(value) {
  return ['/', value, max];
}

const red = normalize(['band', 1]);
const green = normalize(['band', 2]);
const blue = normalize(['band', 3]);
const nir = normalize(['band', 4]);

const ndvi = ['/', ['-', nir, red], ['+', nir, red]];

const styles = {
  trueColor: {
    color: ['array', red, green, blue, 1],
    gamma: 1.1,
  },
  falseColor: {
    color: ['array', nir, red, green, 1],
    gamma: 1.1,
  },
  ndvi: {
    color: [
      'interpolate',
      ['linear'],
      ndvi,
      -0.2,
      [191, 191, 191],
      0,
      [255, 255, 224],
      0.2,
      [145, 191, 82],
      0.4,
      [79, 138, 46],
      0.65,
      [0, 69, 0],
    ],
  },
  ndviPalette: {
    color: [
      'palette',
      ['interpolate', ['linear'], ndvi, -0.2, 0, 0.65, 4],
      ['#0d0887', '#7e03a8', '#cb4778', '#f89540', '#f0f921'],
    ],
  },
};

const base =
  'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/Q/WD/2020/7/S2A_36QWD_20200701_0_L2A/';

const source = new GeoTIFF({
  normalize: false,
  sources: [
    // visible red, green and blue, and near infrared - bands 1 to 4 above
    {url: base + 'B04.tif'},
    {url: base + 'B03.tif'},
    {url: base + 'B02.tif'},
    {url: base + 'B08.tif'},
  ],
});

const layer = new TileLayer({
  style: styles.trueColor,
  source: source,
});

new Map({
  target: 'map',
  layers: [layer],
  view: source.getView(),
});

const styleSelector = document.getElementById('style');
styleSelector.addEventListener('change', function () {
  layer.setStyle(styles[styleSelector.value]);
});
