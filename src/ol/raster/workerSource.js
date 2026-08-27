/**
 * @module ol/raster/workerSource
 */

/**
 * @fileoverview Builds the source of the worker that applies raster styles.  Styles are
 * compiled to JavaScript on the main thread (see {@link module:ol/raster/pipeline}) and their
 * source is baked into the worker, which is then created from a Blob.
 *
 * Generating a whole worker rather than passing source to `new Function` inside a fixed worker
 * is deliberate: creating a worker from a Blob needs `worker-src blob:`, which this renderer
 * already requires, while `new Function` would additionally need `script-src 'unsafe-eval'` —
 * a far harder thing to get past a content security policy.  It also keeps the expression
 * compiler out of the worker payload, since only the emitted loop is shipped.
 *
 * Because the style is baked in, one worker serves a fixed set of styles.  The set is keyed by
 * style id, so a job names the style it wants and the pool is rebuilt only when the set of
 * styles changes — never when their variables do.
 */

/**
 * The part of the worker that does not depend on the styles: it looks up the handler a job
 * names, runs it, and answers with a bitmap.
 * @type {string}
 */
const GLUE = `
// One output array per pixel count, kept and written into again rather than made anew for
// every tile.  A worker only ever runs one job at a time, and \`createImageBitmap\` has
// copied the pixels by the time the next one arrives.
const outputs = {};

self.onmessage = async function (event) {
  const job = event.data;
  try {
    const render = handlers[job.styleId];
    if (!render) {
      throw new Error('No style registered for ' + job.styleId);
    }
    const length = job.size[0] * job.size[1] * 4;
    let output = outputs[length];
    if (!output) {
      output = new Uint8ClampedArray(length);
      outputs[length] = output;
    }
    // integer data is normalized to the 0 to 1 range, matching how an integer texture is
    // sampled; floating point data passes through
    const bandScale = job.data instanceof Float32Array ? 1 : 1 / 255;
    const rgba = render(
      job.data,
      job.size,
      bandScale,
      job.variables || {},
      job.resolution,
      output,
    );
    const bitmap = await createImageBitmap(
      new ImageData(rgba, job.size[0], job.size[1]),
    );
    self.postMessage({bitmap: bitmap, size: job.size}, [bitmap]);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
`;

/**
 * Build the source of a worker serving the given styles.
 * @param {Object<string, string>} handlers Render function source by style id.
 * @return {string} The worker source.
 */
export function buildWorkerSource(handlers) {
  const entries = Object.keys(handlers).map(
    (styleId) => `  ${JSON.stringify(styleId)}: ${handlers[styleId]},`,
  );
  return `const handlers = {\n${entries.join('\n')}\n};\n${GLUE}`;
}

/**
 * Create a worker from generated source.  Falls back to a data URL where `Blob` is missing,
 * as the serialized workers do.
 * @param {string} source The worker source.
 * @return {Worker} The worker.
 */
export function createWorker(source) {
  return new Worker(
    typeof Blob === 'undefined'
      ? 'data:application/javascript;base64,' +
          // @ts-expect-error Buffer is only present where Blob is not
          Buffer.from(source, 'binary').toString('base64')
      : URL.createObjectURL(
          new Blob([source], {type: 'application/javascript'}),
        ),
  );
}
