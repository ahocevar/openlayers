import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/Tile.js';
import DataTile from '../../../../src/ol/source/DataTile.js';

const size = 256;

new Map({
  target: 'map',
  layers: [
    new TileLayer({
      style: {
        color: ['palette', ['*', ['band', 1], 255], ['red', 'green', 'blue']],
      },
      source: new DataTile({
        bandCount: 1,
        tileSize: size,
        maxZoom: 0,
        transition: 0,
        loader: function () {
          const data = new Uint8Array(size * size);
          for (let row = 0; row < size; ++row) {
            const index = Math.floor((row / size) * 3);
            data.fill(index, row * size, (row + 1) * size);
          }
          return data;
        },
      }),
    }),
  ],
  view: new View({center: [0, 0], zoom: 0}),
});

render({
  message: 'band values pick colors from a palette',
});
