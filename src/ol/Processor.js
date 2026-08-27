/**
 * @module ol/Processor
 */
import Disposable from './Disposable.js';

/**
 * A worker, or something that behaves like one.
 *
 * @typedef {Object} WorkerLike
 * @property {function(*, Array<Transferable>=): void} postMessage Post a message.
 * @property {function(): void} terminate Terminate the worker.
 * @property {?function({data: *}): void} onmessage Called with each reply.
 */

/**
 * @typedef {Object} MinionData
 * @property {Array<ArrayBuffer>} buffers Array of buffers.
 * @property {Object} meta Operation metadata.
 * @property {boolean} imageOps The operation is an image operation.
 * @property {number} width The width of the image.
 * @property {number} height The height of the image.
 */

/**
 * Create a function for running operations.  This function is serialized for
 * use in a worker.
 * @param {function(Array<*>, Object):*} operation The operation.
 * @return {function(MinionData):ArrayBuffer} A function that takes an object with
 * buffers, meta, imageOps, width, and height properties and returns an array
 * buffer.
 */
function createMinion(operation) {
  return function (data) {
    // bracket notation for minification support
    const buffers = data['buffers'];
    const meta = data['meta'];
    const imageOps = data['imageOps'];
    const width = data['width'];
    const height = data['height'];

    const numBuffers = buffers.length;
    const numBytes = buffers[0].byteLength;

    if (imageOps) {
      const images = new Array(numBuffers);
      for (let b = 0; b < numBuffers; ++b) {
        images[b] = new ImageData(
          new Uint8ClampedArray(buffers[b]),
          width,
          height,
        );
      }
      const output = operation(images, meta).data;
      return output.buffer;
    }

    const output = new Uint8ClampedArray(numBytes);
    const arrays = new Array(numBuffers);
    const pixels = new Array(numBuffers);
    for (let b = 0; b < numBuffers; ++b) {
      arrays[b] = new Uint8ClampedArray(buffers[b]);
      pixels[b] = [0, 0, 0, 0];
    }
    for (let i = 0; i < numBytes; i += 4) {
      for (let j = 0; j < numBuffers; ++j) {
        const array = arrays[j];
        pixels[j][0] = array[i];
        pixels[j][1] = array[i + 1];
        pixels[j][2] = array[i + 2];
        pixels[j][3] = array[i + 3];
      }
      const pixel = operation(pixels, meta);
      output[i] = pixel[0];
      output[i + 1] = pixel[1];
      output[i + 2] = pixel[2];
      output[i + 3] = pixel[3];
    }
    return output.buffer;
  };
}

/**
 * Create a worker for running operations.
 * @param {import("./source/Raster.js").Operation} operation The operation.
 * @param {Object<string, Function>} [lib] Functions made available to the operation.
 * @return {Worker} The worker.
 */
function createWorker(operation, lib) {
  const declarations = Object.keys(lib || {}).map(function (name) {
    return 'const ' + name + ' = ' + lib?.[name].toString() + ';';
  });

  const lines = declarations.concat([
    'const __minion__ = (' + createMinion.toString() + ')(',
    operation.toString(),
    ');',
    'self.addEventListener("message", function(event) {',
    '  const buffer = __minion__(event.data);',
    '  self.postMessage({buffer: buffer, meta: event.data.meta}, [buffer]);',
    '});',
  ]);

  return new Worker(
    typeof Blob === 'undefined'
      ? 'data:text/javascript;base64,' +
          //@ts-expect-error
          Buffer.from(lines.join('\n'), 'binary').toString('base64')
      : URL.createObjectURL(new Blob(lines, {type: 'text/javascript'})),
  );
}

/**
 * Create a faux worker for running operations on the main thread.
 * @param {import("./source/Raster.js").Operation} operation The operation.
 * @return {WorkerLike} The faux worker.
 */
function createFauxWorker(operation) {
  const minion = createMinion(operation);
  let terminated = false;
  /** @type {WorkerLike} */
  const worker = {
    onmessage: null,
    postMessage: function (/** @type {MinionData & {meta: Object}} */ data) {
      setTimeout(function () {
        if (terminated) {
          return;
        }
        worker.onmessage?.({
          data: {buffer: minion(data), meta: data['meta']},
        });
      }, 0);
    },
    terminate: function () {
      terminated = true;
    },
  };
  return worker;
}

/**
 * @typedef {function(Error|null, ImageData|null, (Object|Array<Object>)): void} JobCallback
 */

/**
 * A unit of work, holding one message per worker it needs.  It is dispatched
 * once that many workers are free.
 *
 * @typedef {Object} Job
 * @property {Array<*>} messages Messages to post, one per worker needed.
 * @property {Array<Array<Transferable>|undefined>} transfer Transferables for each message.
 * @property {function(Array<*>|null): void} callback Called with the replies in
 *     message order, or with `null` if the job was dropped or cancelled.
 * @property {Array<*>} replies Replies received so far.
 * @property {number} remaining Replies still outstanding.
 * @property {boolean} cancelled The job's result is no longer wanted.
 */

/**
 * @typedef {Object} ProcessorOptions
 * @property {number} threads Number of workers to spawn.
 * @property {import("./source/Raster.js").Operation} [operation] The operation.  Required
 * unless `createWorker` is provided.
 * @property {function(): WorkerLike} [createWorker] Creates one worker for the pool.  Use this
 * to run a pre-bundled worker module (see `tasks/serialize-workers.cjs`) instead of a worker
 * built by serializing `operation`.
 * @property {Object<string, Function>} [lib] Functions that will be made available to operations run in a worker.
 * @property {number} queue The number of queued jobs to allow.
 * @property {boolean} [imageOps=false] Pass all the image data to the operation instead of a single pixel.
 */

/**
 * @classdesc
 * A pool of workers.
 */
class Processor extends Disposable {
  /**
   * @param {ProcessorOptions} config Configuration.
   */
  constructor(config) {
    super();

    /**
     * @type {boolean}
     * @private
     */
    this.imageOps_ = !!config.imageOps;
    let threads;
    if (config.threads === 0) {
      threads = 0;
    } else if (this.imageOps_) {
      threads = 1;
    } else {
      threads = config.threads || 1;
    }

    const count = threads || 1;

    /**
     * @type {Array<WorkerLike>}
     * @private
     */
    this.workers_ = new Array(count);

    /**
     * Indices of workers that are not currently handling a message.
     * @type {Array<number>}
     * @private
     */
    this.available_ = new Array(count);

    let makeWorker = config.createWorker;
    if (!makeWorker) {
      const operation = config.operation;
      if (!operation) {
        throw new Error(
          'Processor requires either an operation or a createWorker function',
        );
      }
      const lib = config.lib;
      makeWorker = threads
        ? () =>
            /** @type {WorkerLike} */ (
              /** @type {*} */ (createWorker(operation, lib))
            )
        : () => createFauxWorker(operation);
    }

    for (let i = 0; i < count; ++i) {
      const worker = makeWorker();
      worker.onmessage = this.onWorkerMessage_.bind(this, i);
      this.workers_[i] = worker;
      this.available_[i] = i;
    }

    /**
     * @type {Array<Job>}
     * @private
     */
    this.queue_ = [];

    /**
     * The job and message index each busy worker is handling.
     * @type {Object<number, {job: Job, index: number}>}
     * @private
     */
    this.assignments_ = {};

    /**
     * @type {number}
     * @private
     */
    this.maxQueueLength_ = config.queue || Infinity;
  }

  /**
   * The number of workers in the pool.
   * @return {number} Worker count.
   */
  getThreadCount() {
    return this.workers_.length;
  }

  /**
   * Run an operation on input image data, slicing the work across every worker in the
   * pool.
   *
   * @param {Array<ImageData>} inputs Array of image data.
   * @param {Object} meta A user data object.  This is passed to all operations
   *     and must be serializable.
   * @param {JobCallback} callback Called when work
   *     completes.  The first argument is any error.  The second is the ImageData
   *     generated by operations.  The third is the user data object.
   */
  process(inputs, meta, callback) {
    const threads = this.workers_.length;
    const width = inputs[0].width;
    const height = inputs[0].height;
    // Read the length before anything is transferred; transferring detaches the
    // buffer and leaves the view empty.
    const length = inputs[0].data.length;
    const buffers = inputs.map(function (input) {
      return input.data.buffer;
    });

    /** @type {Array<*>} */
    const messages = [];
    /** @type {Array<Array<Transferable>|undefined>} */
    const transfer = [];

    if (threads === 1) {
      messages.push({
        buffers: buffers,
        meta: meta,
        imageOps: this.imageOps_,
        width: width,
        height: height,
      });
      transfer.push(buffers);
    } else {
      const segmentLength = 4 * Math.ceil(length / 4 / threads);
      for (let i = 0; i < threads; ++i) {
        const offset = i * segmentLength;
        const slices = [];
        for (let j = 0, jj = buffers.length; j < jj; ++j) {
          slices.push(buffers[j].slice(offset, offset + segmentLength));
        }
        messages.push({
          buffers: slices,
          meta: meta,
          imageOps: this.imageOps_,
          width: width,
          height: height,
        });
        transfer.push(slices);
      }
    }

    this.postJob(messages, transfer, function (replies) {
      if (!replies) {
        callback(null, null, {});
        return;
      }
      let data, resultMeta;
      if (replies.length === 1) {
        data = new Uint8ClampedArray(replies[0]['buffer']);
        resultMeta = replies[0]['meta'];
      } else {
        data = new Uint8ClampedArray(length);
        resultMeta = new Array(replies.length);
        const segmentLength = 4 * Math.ceil(length / 4 / replies.length);
        for (let i = 0; i < replies.length; ++i) {
          data.set(
            new Uint8ClampedArray(replies[i]['buffer']),
            i * segmentLength,
          );
          resultMeta[i] = replies[i]['meta'];
        }
      }
      callback(null, new ImageData(data, width, height), resultMeta);
    });
  }

  /**
   * Queue a job, to run once as many workers as it has messages are free.
   *
   * @param {Array<*>} messages One message per worker needed.
   * @param {Array<Array<Transferable>|undefined>} transfer Transferables for each message.
   *     Pass `undefined` for a message whose buffers must survive the call — transferring
   *     detaches them from the caller.
   * @param {function(Array<*>|null): void} callback Called with the replies in message
   *     order, or with `null` if the job was dropped from the queue or cancelled.
   * @return {Job} A handle that can be passed to {@link Processor#cancel}.
   */
  postJob(messages, transfer, callback) {
    /** @type {Job} */
    const job = {
      messages: messages,
      transfer: transfer,
      callback: callback,
      replies: [],
      remaining: 0,
      cancelled: false,
    };
    this.queue_.push(job);
    while (this.queue_.length > this.maxQueueLength_) {
      const dropped = this.queue_.shift();
      dropped?.callback(null);
    }
    this.dispatch_();
    return job;
  }

  /**
   * Abandon a job.  A job still in the queue is never dispatched; one already running
   * is left to finish, but its reply is discarded.  Either way the callback is invoked
   * with `null`.
   * @param {Job} job A handle returned by {@link Processor#postJob}.
   */
  cancel(job) {
    if (job.cancelled) {
      return;
    }
    job.cancelled = true;
    job.callback(null);
  }

  /**
   * Dispatch as many queued jobs as there are free workers to run them.
   * @private
   */
  dispatch_() {
    while (this.queue_.length > 0) {
      const job = this.queue_[0];
      if (job.cancelled) {
        this.queue_.shift();
        continue;
      }
      const needed = job.messages.length;
      if (this.available_.length < needed) {
        return;
      }
      this.queue_.shift();
      job.replies = new Array(needed);
      job.remaining = needed;
      for (let i = 0; i < needed; ++i) {
        const index = /** @type {number} */ (this.available_.shift());
        this.assignments_[index] = {job: job, index: i};
        this.workers_[index].postMessage(job.messages[i], job.transfer[i]);
      }
    }
  }

  /**
   * Handle messages from the worker.
   * @param {number} index The worker index.
   * @param {{data: *}} event The message event.
   * @private
   */
  onWorkerMessage_(index, event) {
    if (this.disposed) {
      return;
    }
    const assignment = this.assignments_[index];
    delete this.assignments_[index];
    this.available_.push(index);
    if (assignment) {
      const job = assignment.job;
      job.replies[assignment.index] = event.data;
      --job.remaining;
      if (job.remaining === 0 && !job.cancelled) {
        job.callback(job.replies);
      }
    }
    this.dispatch_();
  }

  /**
   * Terminate all workers associated with the processor.
   * @override
   */
  disposeInternal() {
    for (let i = 0; i < this.workers_.length; ++i) {
      this.workers_[i].terminate();
    }
    this.workers_.length = 0;
    this.available_.length = 0;
    this.queue_.length = 0;
    this.assignments_ = {};
  }

  /**
   * Dispose of the pool, calling back everything still queued or running with `null` so
   * that a caller which still wants its result can ask for it somewhere else.
   */
  abandon() {
    const abandoned = this.queue_.concat(
      Object.values(this.assignments_).map((assignment) => assignment.job),
    );
    this.queue_.length = 0;
    this.assignments_ = {};
    this.dispose();
    for (const job of abandoned) {
      if (!job.cancelled) {
        job.cancelled = true;
        job.callback(null);
      }
    }
  }
}

export default Processor;
