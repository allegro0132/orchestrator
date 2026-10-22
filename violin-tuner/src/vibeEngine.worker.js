import { generateVibeBars, RULE_MODEL_ID } from './vibeRules.js';
import { skyPrompt } from './skytnt.js';
import { SKY_DEPLOYMENT, loadSkyWeights } from './skyWeights.js';
let decoder,
  active = false;
const post = (value) => self.postMessage(value);
async function load() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter?.features.has('shader-f16'))
    throw new Error(
      'WebGPU with shader-f16 is required. Choose rule-based continuation on this device.',
    );
  const { buffers, persistent } = await loadSkyWeights(
    new URL(`${import.meta.env.BASE_URL}models/${SKY_DEPLOYMENT}/`, self.location.origin),
    (progress) => post({ type: 'progress', ...progress }),
  );
  post({ type: 'initializing' });
  // Load the runtime only after the user explicitly requests Transformer weights.
  const [ort, { default: wasmUrl }, { default: mjsUrl }, { SkyDecoder }] = await Promise.all([
    import('onnxruntime-web/webgpu'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'),
    import('./skyDecoder.js'),
  ]);
  const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
  device.lost.then((info) => {
    if (info.reason !== 'destroyed')
      post({
        type: 'error',
        message: 'WebGPU device lost. Reload the model or choose rule-based continuation.',
      });
  });
  ort.env.webgpu.device = device;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    wasm: new URL(wasmUrl, self.location.href).href,
    mjs: new URL(mjsUrl, self.location.href).href,
  };
  ort.env.logLevel = 'warning';
  const preferred = (layers) =>
    Object.fromEntries(
      Array.from({ length: layers }, (_, i) =>
        ['key', 'value'].map((type) => [`present.${i}.${type}`, 'gpu-buffer']),
      ).flat(),
    );
  const base = await ort.InferenceSession.create(buffers.base, {
    executionProviders: ['webgpu'],
    preferredOutputLocation: { hidden: 'gpu-buffer', ...preferred(12) },
  });
  delete buffers.base;
  const token = await ort.InferenceSession.create(buffers.token, {
    executionProviders: ['webgpu'],
    preferredOutputLocation: { y: 'cpu', ...preferred(3) },
  });
  decoder = new SkyDecoder(ort, base, token);
  post({ type: 'ready', persistent });
}
self.onmessage = async ({ data }) => {
  if (active) return;
  active = true;
  try {
    if (data.type === 'load') {
      if (data.engine === RULE_MODEL_ID) post({ type: 'ready' });
      else await load();
    } else if (data.type === 'predict') {
      const start = performance.now(),
        request = data.request;
      const bars =
        request.predictor === RULE_MODEL_ID
          ? generateVibeBars(
              request.notes,
              request.fromBar,
              request.count,
              request.bpm,
              request.key,
              request.seed,
            )
          : (await decoder.generate(skyPrompt(request.notes, request), { seed: request.seed }))
              .bars;
      post({ type: 'result', id: data.id, bars, milliseconds: performance.now() - start });
    }
  } catch (error) {
    post({ type: 'error', message: error.message });
  } finally {
    active = false;
  }
};
