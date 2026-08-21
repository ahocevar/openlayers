import {assert} from 'chai';
import DataTile, {
  asArrayLike,
  asImageLike,
  getBandCount,
  toArray,
  toImageData,
} from '../../../../src/ol/DataTile.js';
import TileState from '../../../../src/ol/TileState.js';
import {listenOnce} from '../../../../src/ol/events.js';

describe('ol/DataTile', function () {
  /**
   * @type {Promise<import('../../../../src/ol/DataTile.js').Data>}
   */
  let loader;
  beforeEach(function () {
    loader = function () {
      return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        context.fillStyle = 'red';
        context.fillRect(0, 0, 256, 256);
        resolve(context.getImageData(0, 0, 256, 256).data);
      });
    };
  });

  describe('constructor', function () {
    it('sets options', function () {
      const tileCoord = [0, 0, 0];
      const tile = new DataTile({
        tileCoord: tileCoord,
        loader: loader,
        transition: 200,
      });
      assert.equal(tile.tileCoord, tileCoord);
      assert.strictEqual(tile.transition_, 200);
      assert.equal(tile.loader_, loader);
    });
  });

  describe('#getSize()', function () {
    it('returns [256, 256] by default', function () {
      const tileCoord = [0, 0, 0];
      const tile = new DataTile({
        tileCoord: tileCoord,
        loader: loader,
      });
      assert.deepEqual(tile.getSize(), [256, 256]);
    });

    it('respects what is provided in the constructor', function () {
      const size = [123, 456];
      const tileCoord = [0, 0, 0];
      const tile = new DataTile({
        size: size,
        tileCoord: tileCoord,
        loader: loader,
      });
      assert.deepEqual(tile.getSize(), size);
    });
  });

  describe('#load()', function () {
    it('handles loading states correctly', () =>
      new Promise((resolve) => {
        const tileCoord = [0, 0, 0];
        const tile = new DataTile({
          tileCoord: tileCoord,
          loader: loader,
        });
        assert.strictEqual(tile.getState(), TileState.IDLE);
        tile.load();
        assert.strictEqual(tile.getState(), TileState.LOADING);
        listenOnce(tile, 'change', () => {
          assert.strictEqual(tile.getState(), TileState.LOADED);
          resolve();
        });
      }));

    it('reloads tiles in an error state', () =>
      new Promise((resolve) => {
        const tileCoord = [0, 0, 0];
        const tile = new DataTile({
          tileCoord: tileCoord,
          loader: loader,
        });
        tile.state = TileState.ERROR;

        tile.load();
        assert.strictEqual(tile.getState(), TileState.LOADING);
        listenOnce(tile, 'change', () => {
          assert.strictEqual(tile.getState(), TileState.LOADED);
          resolve();
        });
      }));
  });

  describe('#getData() #asArrayLike() #asImageLike() #toArray()', function () {
    it('handles array data correctly', () =>
      new Promise((resolve) => {
        const tileCoord = [0, 0, 0];
        const tile = new DataTile({
          tileCoord: tileCoord,
          loader: loader,
        });
        tile.load();
        listenOnce(tile, 'change', () => {
          assert.strictEqual(tile.getState(), TileState.LOADED);
          const data = tile.getData();
          assert.instanceOf(data, Uint8ClampedArray);
          assert.strictEqual(data.length, 262144);
          const expected = [255, 0, 0, 255, 255, 0, 0, 255];
          assert.deepEqual(Array.from(data.slice(0, 8)), expected);
          assert.strictEqual(asImageLike(data), null);
          assert.strictEqual(asArrayLike(data), data);
          resolve();
        });
      }));

    it('handles image data correctly', () =>
      new Promise((resolve) => {
        const loadImage = function (src) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.addEventListener('load', () => resolve(img));
            img.addEventListener('error', () =>
              reject(new Error('load failed')),
            );
            img.src = src;
          });
        };
        const loader = async function () {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const context = canvas.getContext('2d');
          context.fillStyle = 'red';
          context.fillRect(0, 0, 256, 256);
          const src = canvas.toDataURL();
          const image = await loadImage(src);
          return image;
        };
        const tileCoord = [0, 0, 0];
        const tile = new DataTile({
          tileCoord: tileCoord,
          loader: loader,
        });
        tile.load();
        listenOnce(tile, 'change', () => {
          assert.strictEqual(tile.getState(), TileState.LOADED);
          const data = tile.getData();
          assert.instanceOf(data, Image);
          assert.strictEqual(data.width, 256);
          assert.strictEqual(data.height, 256);
          assert.strictEqual(asArrayLike(data), null);
          assert.strictEqual(asImageLike(data), data);
          const imageData = toArray(asImageLike(data));
          assert.instanceOf(imageData, Uint8ClampedArray);
          assert.strictEqual(imageData.length, 262144);
          const expected = [255, 0, 0, 255, 255, 0, 0, 255];
          assert.deepEqual(Array.from(imageData.slice(0, 8)), expected);
          resolve();
        });
      }));
  });
  describe('getBandCount()', function () {
    it('derives the band count from the byte length and size', function () {
      assert.strictEqual(getBandCount(new Uint8Array(2 * 3 * 4), [2, 3]), 4);
      assert.strictEqual(getBandCount(new Uint8Array(2 * 3 * 1), [2, 3]), 1);
      assert.strictEqual(getBandCount(new Float32Array(2 * 3 * 2), [2, 3]), 2);
    });
  });

  describe('toImageData()', function () {
    it('expands one band to luminance', function () {
      const data = new Uint8Array([0, 128, 255, 10]);
      const imageData = toImageData(data, [2, 2], 1);
      assert.deepEqual(
        Array.from(imageData.data.slice(0, 8)),
        [0, 0, 0, 255, 128, 128, 128, 255],
      );
    });

    it('expands two bands to luminance and alpha', function () {
      const data = new Uint8Array([128, 64, 255, 0]);
      const imageData = toImageData(data, [2, 1], 2);
      assert.deepEqual(
        Array.from(imageData.data),
        [128, 128, 128, 64, 255, 255, 255, 0],
      );
    });

    it('expands three bands to opaque rgb', function () {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
      const imageData = toImageData(data, [2, 1], 3);
      assert.deepEqual(
        Array.from(imageData.data),
        [1, 2, 3, 255, 4, 5, 6, 255],
      );
    });

    it('takes rgba from the first four of many bands', function () {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
      const imageData = toImageData(data, [1, 1], 6);
      assert.deepEqual(Array.from(imageData.data), [1, 2, 3, 4]);
    });

    it('scales float values from 0-1 to 0-255', function () {
      const data = new Float32Array([0, 0.5, 1, 2]);
      const imageData = toImageData(data, [2, 2], 1);
      assert.deepEqual(
        Array.from(imageData.data.slice(0, 12)),
        [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255],
      );
    });

    it('reuses a four band Uint8ClampedArray without copying', function () {
      const data = new Uint8ClampedArray([1, 2, 3, 4]);
      const imageData = toImageData(data, [1, 1], 4);
      assert.strictEqual(imageData.data.buffer, data.buffer);
    });
  });
});
