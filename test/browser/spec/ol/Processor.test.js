import {assert} from 'chai';
import Processor from '../../../../src/ol/Processor.js';

/** Records which worker was posted which message, in dispatch order. */
let log;

/** The workers the pools were built from, in creation order. */
let workers;

/** @type {Array<Processor>} */
let processors;

/**
 * A faux worker that echoes each message back after a delay, so job dispatch
 * order and concurrency can be observed without spawning real workers.
 * @param {string} name The worker name.
 * @return {import('../../../../src/ol/Processor.js').WorkerLike} The worker.
 */
function createEchoWorker(name) {
  const worker = {
    onmessage: null,
    transfers: [],
    postMessage(data, transfer) {
      log.push(`${name}:${data}`);
      worker.transfers.push(transfer);
      setTimeout(() => worker.onmessage?.({data: data}), 0);
    },
    terminate() {},
  };
  workers.push(worker);
  return worker;
}

/**
 * @param {number} threads The number of workers.
 * @param {number} queue The queue length.
 * @return {Processor} A pool of echo workers.
 */
function createProcessor(threads, queue) {
  const processor = new Processor({
    threads: threads,
    queue: queue,
    createWorker: () => createEchoWorker(`w${workers.length + 1}`),
  });
  processors.push(processor);
  return processor;
}

/**
 * @return {Promise<void>} Resolves once every echoed reply has been delivered.
 */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('ol/Processor', function () {
  beforeEach(function () {
    log = [];
    workers = [];
    processors = [];
  });

  afterEach(function () {
    processors.forEach((processor) => processor.dispose());
  });

  describe('createWorker option', function () {
    it('builds the pool from the injected factory', function () {
      const processor = createProcessor(3, 4);
      assert.equal(workers.length, 3);
      assert.equal(processor.getThreadCount(), 3);
    });

    it('throws without an operation or a factory', function () {
      assert.throws(() => new Processor({threads: 1, queue: 1}), /operation/);
    });
  });

  describe('#postJob()', function () {
    it('runs single-message jobs concurrently, one per worker', async () => {
      const processor = createProcessor(2, 10);
      for (const message of ['a', 'b', 'c']) {
        processor.postJob([message], [undefined], () => {});
      }
      await settled();

      // the first two jobs occupy both workers; the third waits for one to free
      // up and lands on whichever replied first
      assert.deepEqual(log.slice(0, 2), ['w1:a', 'w2:b']);
      assert.include(['w1:c', 'w2:c'], log[2]);
      assert.equal(log.length, 3);
    });

    it('reports replies in message order', async () => {
      let replies;
      createProcessor(2, 10).postJob(
        ['first', 'second'],
        [undefined, undefined],
        (received) => (replies = received),
      );
      await settled();

      assert.deepEqual(replies, ['first', 'second']);
    });

    it('posts only the transferables it is given', async () => {
      const processor = createProcessor(1, 10);
      const kept = new Uint8Array([1, 2, 3, 4]);
      const transferred = new Uint8Array([5, 6, 7, 8]);
      processor.postJob([kept], [undefined], () => {});
      processor.postJob([transferred], [[transferred.buffer]], () => {});
      await settled();

      assert.deepEqual(workers[0].transfers, [undefined, [transferred.buffer]]);
      // a message posted without transferables leaves the caller's buffer attached
      assert.deepEqual(Array.from(kept), [1, 2, 3, 4]);
    });

    it('drops the oldest queued jobs beyond the queue length', async () => {
      const processor = createProcessor(1, 1);
      const results = [];
      for (const message of ['a', 'b', 'c']) {
        processor.postJob([message], [undefined], (replies) =>
          results.push(replies),
        );
      }
      await settled();

      // 'a' is dispatched immediately, 'b' is queued and then dropped by 'c'
      assert.deepEqual(results, [null, ['a'], ['c']]);
    });
  });

  describe('#cancel()', function () {
    it('discards the reply of a running job', async () => {
      const processor = createProcessor(1, 10);
      const replies = [];
      const job = processor.postJob(['a'], [undefined], (received) =>
        replies.push(received),
      );
      processor.cancel(job);
      await settled();

      assert.deepEqual(replies, [null]);
    });

    it('keeps a cancelled job from occupying a worker', async () => {
      const processor = createProcessor(1, 10);
      processor.postJob(['a'], [undefined], () => {});
      processor.cancel(processor.postJob(['b'], [undefined], () => {}));
      await settled();

      assert.deepEqual(log, ['w1:a']);
    });
  });
});
