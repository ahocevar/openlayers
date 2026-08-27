import {assert} from 'chai';
import {createCanvasContext2D} from '../../../../../src/ol/dom.js';
import {
  dropLayerHandlers,
  ensureHandler,
  getStyleProcessor,
  getWorkerCount,
  setWorkerCount,
} from '../../../../../src/ol/raster/processor.js';

function postStyleJob(processor, styleId) {
  return new Promise((resolve) => {
    processor.postJob(
      [
        {
          styleId: styleId,
          data: new Uint8Array([0, 255]),
          size: [2, 1],
        },
      ],
      [undefined],
      (replies) => resolve(replies?.[0] ?? null),
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
    dropLayerHandlers('layer-a');
    dropLayerHandlers('layer-b');
  });

  it('spawns as many workers as configured', () => {
    setWorkerCount(2);
    assert.strictEqual(getStyleProcessor().getThreadCount(), 2);
  });

  it('always keeps a worker to run styles on', () => {
    setWorkerCount(0);
    assert.strictEqual(getWorkerCount(), 1);
  });

  it('gives a job that was abandoned somewhere to run', async () => {
    setWorkerCount(1);
    const styleId = ensureHandler(
      'layer-a/1',
      {color: ['array', ['band', 1], 0, 0, 1]},
      1,
      undefined,
    );
    const styled = new Promise((resolve) => {
      // asking again from inside the callback, the way a styled tile does: the pool the
      // job was abandoned by is still the one on hand there
      const post = () =>
        getStyleProcessor().postJob(
          [{styleId: styleId, data: new Uint8Array([0, 255]), size: [2, 1]}],
          [undefined],
          (replies) => (replies ? resolve(replies[0]) : post()),
        );
      post();
    });
    // another layer's style arrives while that job is running
    ensureHandler('layer-b/1', {color: ['array', 0, 0, 0, 1]}, 1, undefined);

    assert.deepEqual(
      toPixels((await styled).bitmap),
      [0, 0, 0, 255, 255, 0, 0, 255],
    );
  });

  it('renders a job with the style baked into the worker', async () => {
    setWorkerCount(1);
    const styleId = ensureHandler(
      'layer-a/1',
      {color: ['array', ['band', 1], 0, 0, 1]},
      1,
      undefined,
    );
    const reply = await postStyleJob(getStyleProcessor(), styleId);

    assert.deepEqual(toPixels(reply.bitmap), [0, 0, 0, 255, 255, 0, 0, 255]);
  });
});

describe('ol/raster/processor.js compiled styles', function () {
  const style = {
    variables: {red: 1},
    color: ['array', ['var', 'red'], 0, 0, 1],
  };

  afterEach(function () {
    dropLayerHandlers('layer-a');
  });

  it('keeps the pool when a handler is already registered', function () {
    assert.strictEqual(
      ensureHandler('layer-a/1', style, 1, undefined),
      'layer-a/1/1/',
    );
    const pool = getStyleProcessor();
    // the same style and band layout again: nothing to compile, nothing to rebuild
    assert.strictEqual(
      ensureHandler('layer-a/1', style, 1, undefined),
      'layer-a/1/1/',
    );
    assert.strictEqual(getStyleProcessor(), pool);
  });

  it('rebuilds the pool for a band layout it has not compiled for', function () {
    ensureHandler('layer-a/1', style, 1, undefined);
    const pool = getStyleProcessor();
    assert.strictEqual(
      ensureHandler('layer-a/1', style, 4, undefined),
      'layer-a/1/4/',
    );
    assert.notStrictEqual(getStyleProcessor(), pool);
  });

  it('supersedes the handlers of a previous style revision', function () {
    ensureHandler('layer-a/1', style, 1, undefined);
    const pool = getStyleProcessor();
    assert.strictEqual(
      ensureHandler('layer-a/2', style, 1, undefined),
      'layer-a/2/1/',
    );
    assert.notStrictEqual(getStyleProcessor(), pool);
    // a tile that has not been told about the new revision may still ask for the old one,
    // which is gone for good: compiling it again would take the new one out of the worker
    const rebuilt = getStyleProcessor();
    assert.isNull(ensureHandler('layer-a/1', style, 1, undefined));
    assert.strictEqual(getStyleProcessor(), rebuilt);
  });

  it('drops every revision and band layout a layer compiled', function () {
    ensureHandler('layer-a/1', style, 1, undefined);
    ensureHandler('layer-a/1', style, 4, undefined);
    const pool = getStyleProcessor();
    dropLayerHandlers('layer-a');
    assert.notStrictEqual(getStyleProcessor(), pool);
    // nothing left to drop, so the pool stands
    const rebuilt = getStyleProcessor();
    dropLayerHandlers('layer-a');
    assert.strictEqual(getStyleProcessor(), rebuilt);
  });

  it('throws for a style it cannot compile', function () {
    assert.throws(
      () =>
        ensureHandler(
          'layer-a/1',
          {color: ['array', ['get', 'red'], 0, 0, 1]},
          1,
          undefined,
        ),
      /'get' operator reads feature data/,
    );
  });
});
