import {assert} from 'chai';
import {createCanvasContext2D} from '../../../../../src/ol/dom.js';
import {create} from '../../../../../src/ol/worker/rasterStyle.js';

describe('ol/worker/rasterStyle', () => {
  let worker;
  beforeEach(() => {
    worker = create();
    worker.addEventListener('error', () => {
      assert.fail();
    });
  });

  afterEach(() => {
    if (worker) {
      worker.terminate();
    }
    worker = null;
  });

  /**
   * @param {Object} message The message to post.
   * @return {Promise<Object>} The reply.
   */
  function post(message) {
    return new Promise((resolve) => {
      worker.addEventListener('message', (event) => resolve(event.data), {
        once: true,
      });
      worker.postMessage(message);
    });
  }

  /**
   * @param {Object} options Style, data and band count overrides.
   * @return {Promise<Array<number>>} The rendered pixels.
   */
  async function render(options) {
    const reply = await post({
      styleId: options.styleId ?? 1,
      style: options.style,
      bandCount: options.bandCount,
      nodataBandIndex: options.nodataBandIndex,
      data: options.data,
      size: options.size ?? [2, 1],
      variables: options.variables,
    });
    assert.isUndefined(reply.error);
    const bitmap = reply.bitmap;
    const width = bitmap.width;
    const height = bitmap.height;
    const context = createCanvasContext2D(width, height);
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(0, 0, width, height).data);
  }

  it('renders a color expression over band values', async () => {
    const pixels = await render({
      style: {
        color: ['array', ['band', 1], 0, 0, 1],
      },
      bandCount: 1,
      data: new Uint8Array([0, 255]),
    });
    assert.deepEqual(pixels, [0, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('reads the bands directly when the style has no color', async () => {
    const pixels = await render({
      style: {},
      bandCount: 3,
      data: new Uint8Array([10, 20, 30, 40, 50, 60]),
    });
    assert.deepEqual(pixels, [10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('makes nodata pixels transparent', async () => {
    const pixels = await render({
      style: {},
      bandCount: 2,
      nodataBandIndex: 2,
      data: new Uint8Array([100, 255, 200, 0]),
    });
    assert.deepEqual(pixels, [100, 100, 100, 255, 0, 0, 0, 0]);
  });

  it('passes float band values through unscaled', async () => {
    const pixels = await render({
      style: {color: ['array', ['band', 1], 0, 0, 1]},
      bandCount: 1,
      data: new Float32Array([0, 1]),
    });
    assert.deepEqual(pixels, [0, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('applies style variables from the message', async () => {
    const options = {
      style: {
        color: ['array', 1, 1, 1, 1],
        brightness: ['var', 'brightness'],
      },
      bandCount: 1,
      data: new Uint8Array([255, 255]),
    };
    const bright = await render({...options, variables: {brightness: 0}});
    assert.deepEqual(bright.slice(0, 3), [255, 255, 255]);

    const dark = await render({...options, variables: {brightness: -1}});
    assert.deepEqual(dark.slice(0, 3), [0, 0, 0]);
  });

  it('desaturates to luminance at a saturation of -1', async () => {
    const pixels = await render({
      style: {saturation: -1},
      bandCount: 3,
      size: [1, 1],
      data: new Uint8Array([255, 0, 0]),
    });
    // 0.2126 * 255, rounded by the clamped array
    assert.deepEqual(pixels, [54, 54, 54, 255]);
  });

  it('reports an error instead of leaving the tile pending', async () => {
    const reply = await post({
      styleId: 'bad',
      style: {color: ['not-an-operator', 1]},
      bandCount: 1,
      data: new Uint8Array([1]),
      size: [1, 1],
    });
    assert.match(reply.error, /not-an-operator/);
  });
});
