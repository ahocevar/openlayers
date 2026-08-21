import {assert} from 'chai';
import {createCanvasContext2D} from '../../../../../src/ol/dom.js';
import {
  acquireProcessor,
  getWorkerCount,
  releaseProcessor,
  setWorkerCount,
} from '../../../../../src/ol/raster/processor.js';

function postStyleJob(processor) {
  return new Promise((resolve) => {
    processor.postJob(
      [
        {
          styleId: 1,
          style: {color: ['array', ['band', 1], 0, 0, 1]},
          bandCount: 1,
          data: new Uint8Array([0, 255]),
          size: [2, 1],
        },
      ],
      [undefined],
      (replies) => resolve(replies[0]),
    );
  });
}

function toPixels(bitmap) {
  const context = createCanvasContext2D(2, 1);
  context.drawImage(bitmap, 0, 0);
  return Array.from(context.getImageData(0, 0, 2, 1).data);
}

describe('ol/raster/processor', () => {
  let workerCount;
  beforeEach(() => {
    workerCount = getWorkerCount();
  });

  afterEach(() => {
    setWorkerCount(workerCount);
  });

  it('shares one pool, and terminates it when the last holder lets go', () => {
    const processor = acquireProcessor();
    assert.strictEqual(acquireProcessor(), processor);
    releaseProcessor();
    releaseProcessor();
    assert.notStrictEqual(acquireProcessor(), processor);
    releaseProcessor();
  });

  it('spawns as many workers as configured', () => {
    setWorkerCount(2);
    const processor = acquireProcessor();
    assert.strictEqual(processor.getThreadCount(), 2);
    releaseProcessor();
  });

  it('runs jobs posted before the worker has been fetched', async () => {
    setWorkerCount(1);
    const processor = acquireProcessor();
    const reply = await postStyleJob(processor);
    releaseProcessor();

    assert.deepEqual(toPixels(reply.bitmap), [0, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('applies the style on the main thread with a worker count of 0', async () => {
    setWorkerCount(0);
    const processor = acquireProcessor();
    const reply = await postStyleJob(processor);
    releaseProcessor();

    assert.deepEqual(toPixels(reply.bitmap), [0, 0, 0, 255, 255, 0, 0, 255]);
  });
});
