import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import DataTile from '../../../../src/ol/source/DataTile.js';

const size = 256;

const canvas = document.createElement('canvas');
canvas.width = size;
canvas.height = size;
const context = canvas.getContext('2d');
context.fillStyle = 'rgb(200, 40, 40)';
context.fillRect(0, 0, size, size / 2);
context.fillStyle = 'rgb(40, 40, 200)';
context.fillRect(0, size / 2, size, size / 2);

new Map({
  target: 'map',
  layers: [
    new TileLayer({
      // Image data is read as four bands of rgba, so this swaps red and blue.
      style: {
        color: ['array', ['band', 3], ['band', 2], ['band', 1], ['band', 4]],
      },
      source: new DataTile({
        tileSize: size,
        maxZoom: 0,
        transition: 0,
        loader: () => createImageBitmap(canvas),
      }),
    }),
  ],
  view: new View({center: [0, 0], zoom: 0}),
});

render({
  message: 'a style applies to the rgba of image data',
});
