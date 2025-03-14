import Map from '../../../../src/ol/Map.js';
import View from '../../../../src/ol/View.js';
import TileLayer from '../../../../src/ol/layer/WebGLTile.js';
import DataTile from '../../../../src/ol/source/DataTile.js';

const size = [81, 99];

const canvas = document.createElement('canvas');
canvas.width = size[0];
canvas.height = size[1];

const context = canvas.getContext('2d');
context.strokeStyle = 'white';
context.textAlign = 'center';
const lineHeight = 16;
context.font = `${lineHeight}px sans-serif`;

new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new DataTile({
        transition: 0,
        tileSize: size,
        bandCount: 8,
        loader: function (z, x, y) {
          const halfWidth = size[0] / 2;
          const halfHeight = size[1] / 2;
          context.fillStyle = '#00AAFF';
          context.fillRect(0, 0, size[0], size[1]);
          context.fillStyle = 'white';
          context.fillText(`z: ${z}`, halfWidth, halfHeight - lineHeight);
          context.fillText(`x: ${x}`, halfWidth, halfHeight);
          context.fillText(`y: ${y}`, halfWidth, halfHeight + lineHeight);
          context.strokeRect(0, 0, size[0], size[1]);
          const input = context.getImageData(0, 0, size[0], size[1]).data;
          const length = input.length;
          const output = new Uint8Array(length * 2);
          for (let i = 0, j = 4; i < length; i += 4) {
            output[j] = input[i];
            output[j + 1] = input[i + 1];
            output[j + 2] = input[i + 2];
            output[j + 3] = input[i + 3];
            j += 8;
          }
          return output;
        },
      }),
      style: {
        color: ['array', ['band', 5], ['band', 6], ['band', 7], ['band', 8]],
      },
    }),
  ],
  view: new View({
    center: [0, 0],
    zoom: 4,
  }),
});

render({tolerance: 0.03});
