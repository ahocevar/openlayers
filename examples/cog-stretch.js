import Map from '../src/ol/Map.js';
import TileLayer from '../src/ol/layer/WebGLTile.js';
import GeoTIFF from '../src/ol/source/GeoTIFF.js';

const channels = ['red', 'green', 'blue'];
for (const channel of channels) {
  const selector = document.getElementById(channel);
  selector.addEventListener('change', update);

  const input = document.getElementById(`${channel}Max`);
  input.addEventListener('input', update);
}

function getVariables() {
  const variables = {};
  for (const channel of channels) {
    const selector = document.getElementById(channel);
    variables[channel] = parseInt(selector.value, 10);

    const inputId = `${channel}Max`;
    const input = document.getElementById(inputId);
    variables[inputId] = parseInt(input.value, 10);
  }
  return variables;
}

const base =
  'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/Q/WD/2020/7/S2A_36QWD_20200701_0_L2A/';

const source = new GeoTIFF({
  normalize: false,
  sources: [
    // visible red, green and blue, and near infrared - the channels to choose from
    {url: base + 'B04.tif'},
    {url: base + 'B03.tif'},
    {url: base + 'B02.tif'},
    {url: base + 'B08.tif'},
  ],
});

const layer = new TileLayer({
  style: {
    variables: getVariables(),
    color: [
      'array',
      ['/', ['band', ['var', 'red']], ['var', 'redMax']],
      ['/', ['band', ['var', 'green']], ['var', 'greenMax']],
      ['/', ['band', ['var', 'blue']], ['var', 'blueMax']],
      1,
    ],
  },
  source: source,
});

function update() {
  layer.updateStyleVariables(getVariables());
}

const map = new Map({
  target: 'map',
  layers: [layer],
  view: source.getView(),
});
