import {assert} from 'chai';
import Processor from '../../../../src/ol/Processor.js';

/**
 * A faux worker that echoes each message back after a delay, so job dispatch
 * order and concurrency can be observed without spawning real workers.
 * @param {Array<string>} log Records which worker handled which message.
 * @param {string} name The worker name.
 * @return {import('../../../../src/ol/Processor.js').WorkerLike} The worker.
 */
function createEchoWorker(log, name) {
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
  return worker;
}

describe('ol/Processor', function () {
  describe('createWorker option', function () {
    it('builds the pool from the injected factory', function () {
      let created = 0;
      const processor = new Processor({
        threads: 3,
        queue: 4,
        createWorker: () => {
          ++created;
          return createEchoWorker([], `w${created}`);
        },
      });

      assert.equal(created, 3);
      assert.equal(processor.getThreadCount(), 3);
    });

    it('throws without an operation or a factory', function () {
      assert.throws(() => new Processor({threads: 1, queue: 1}), /operation/);
    });
  });

  describe('#postJob()', function () {
    it('runs single-message jobs concurrently, one per worker', () =>
      new Promise((resolve) => {
        const log = [];
        let index = 0;
        const processor = new Processor({
          threads: 2,
          queue: 10,
          createWorker: () => createEchoWorker(log, `w${++index}`),
        });

        let done = 0;
        const finish = () => {
          if (++done === 3) {
            // The first two jobs occupy both workers; the third waits for one
            // to free up and lands on whichever replied first.
            assert.deepEqual(log.slice(0, 2), ['w1:a', 'w2:b']);
            assert.equal(log.length, 3);
            assert.include(['w1:c', 'w2:c'], log[2]);
            resolve();
          }
        };

        processor.postJob(['a'], [undefined], finish);
        processor.postJob(['b'], [undefined], finish);
        processor.postJob(['c'], [undefined], finish);
      }));

    it('reports replies in message order', () =>
      new Promise((resolve) => {
        const processor = new Processor({
          threads: 2,
          queue: 10,
          createWorker: () => createEchoWorker([], 'w'),
        });

        processor.postJob(
          ['first', 'second'],
          [undefined, undefined],
          (replies) => {
            assert.deepEqual(replies, ['first', 'second']);
            resolve();
          },
        );
      }));

    it('posts no transferables when none are given, leaving buffers attached', () =>
      new Promise((resolve) => {
        let worker;
        const processor = new Processor({
          threads: 1,
          queue: 10,
          createWorker: () => {
            worker = createEchoWorker([], 'w');
            return worker;
          },
        });

        const data = new Uint8Array([1, 2, 3, 4]);
        processor.postJob([data], [undefined], () => {
          assert.deepEqual(worker.transfers, [undefined]);
          assert.equal(data.length, 4);
          assert.equal(data[0], 1);
          resolve();
        });
      }));

    it('posts the transferables it is given', () =>
      new Promise((resolve) => {
        let worker;
        const processor = new Processor({
          threads: 1,
          queue: 10,
          createWorker: () => {
            worker = createEchoWorker([], 'w');
            return worker;
          },
        });

        const data = new Uint8Array([1, 2, 3, 4]);
        processor.postJob([data], [[data.buffer]], () => {
          assert.deepEqual(worker.transfers, [[data.buffer]]);
          resolve();
        });
      }));

    it('drops the oldest queued jobs beyond the queue length', () =>
      new Promise((resolve) => {
        const processor = new Processor({
          threads: 1,
          queue: 1,
          createWorker: () => createEchoWorker([], 'w'),
        });

        const results = [];
        const finish = (replies) => {
          results.push(replies);
          if (results.length === 3) {
            // The first job is dispatched immediately; the second is queued and
            // then dropped by the third.
            assert.deepEqual(results, [null, ['a'], ['c']]);
            resolve();
          }
        };

        processor.postJob(['a'], [undefined], finish);
        processor.postJob(['b'], [undefined], finish);
        processor.postJob(['c'], [undefined], finish);
      }));
  });

  describe('#cancel()', function () {
    it('discards the reply of a running job', () =>
      new Promise((resolve) => {
        const processor = new Processor({
          threads: 1,
          queue: 10,
          createWorker: () => createEchoWorker([], 'w'),
        });

        let calls = 0;
        const job = processor.postJob(['a'], [undefined], (replies) => {
          ++calls;
          assert.isNull(replies);
        });
        processor.cancel(job);

        setTimeout(() => {
          assert.equal(calls, 1);
          resolve();
        }, 20);
      }));

    it('keeps a cancelled job from occupying a worker', () =>
      new Promise((resolve) => {
        const log = [];
        const processor = new Processor({
          threads: 1,
          queue: 10,
          createWorker: () => createEchoWorker(log, 'w'),
        });

        processor.postJob(['a'], [undefined], () => {});
        const second = processor.postJob(['b'], [undefined], () => {});
        processor.cancel(second);

        setTimeout(() => {
          assert.deepEqual(log, ['w:a']);
          resolve();
        }, 20);
      }));
  });
});
