import {assert} from 'chai';
import {
  getStyleProcessor,
  getWorkerCount,
  setWorkerCount,
} from '../../../../../src/ol/raster/processor.js';

const style = {color: ['array', ['band', 1], 0, 0, 1]};

function postStyleJob(processor) {
  return new Promise((resolve) => {
    processor.postJob(
      [
        {
          styleId: 'layer-a/1',
          style: style,
          data: new Uint8Array([0, 255]),
          size: [2, 1],
          bandCount: 1,
        },
      ],
      [undefined],
      (replies) => resolve(replies?.[0] ?? null),
    );
  });
}

describe('ol/raster/processor', () => {
  let workerCount;
  beforeEach(() => {
    workerCount = getWorkerCount();
  });

  afterEach(() => {
    setWorkerCount(workerCount);
  });

  it('spawns as many workers as configured', () => {
    setWorkerCount(2);
    assert.strictEqual(getStyleProcessor().getThreadCount(), 2);
  });

  it('always keeps a worker to run styles on', () => {
    setWorkerCount(0);
    assert.strictEqual(getWorkerCount(), 1);
  });

  it('answers a job with the pixels the style made', async () => {
    setWorkerCount(1);
    const reply = await postStyleJob(getStyleProcessor());

    assert.instanceOf(reply.bitmap, ImageBitmap);
    assert.strictEqual(reply.bitmap.width, 2);
    assert.strictEqual(reply.bitmap.height, 1);
  });

  it('gives a job that was abandoned somewhere to run', async () => {
    setWorkerCount(1);
    const styled = new Promise((resolve) => {
      // asking again from inside the callback, the way a styled tile does
      const post = () =>
        postStyleJob(getStyleProcessor()).then((reply) =>
          reply ? resolve(reply) : post(),
        );
      post();
    });
    setWorkerCount(2);

    assert.instanceOf((await styled).bitmap, ImageBitmap);
  });
});
