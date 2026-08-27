import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import DataTile from '../../../../src/ol/source/DataTile.js';

const size = 256;

// filled in after the layer is built, the way the shaded relief example does
const variables = {};

const layer = new TileLayer({
  style: {
    variables: variables,
    color: [
      'array',
      ['var', 'red'],
      // green only where the resolution is a real, positive number
      ['case', ['>', ['resolution'], 0], 1, 0],
      0,
      1,
    ],
  },
  source: new DataTile({
    bandCount: 1,
    tileSize: size,
    maxZoom: 0,
    transition: 0,
    loader: () => new Uint8Array(size * size),
  }),
});

variables.red = 1;

const map = new Map({
  target: 'map',
  layers: [layer],
  view: new View({center: [0, 0], zoom: 0}),
});

map.once('rendercomplete', () => {
  variables.red = 100 / 255;
  layer.updateStyleVariables(variables);
  map.once('rendercomplete', () =>
    render({
      message: 'a style reads updated variables and the view resolution',
    }),
  );
});
