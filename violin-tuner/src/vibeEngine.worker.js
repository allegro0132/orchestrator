import { generateVibeBars, RULE_MODEL_ID } from './vibeRules.js';
import { skyPrompt, skyCompletedBars } from './skytnt.js';
import { SKY_DEPLOYMENT, loadSkyWeights } from './skyWeights.js';
import { createVibeEngineHost, VIBE_ENGINE_PROTOCOL, VibeEngineError } from './vibeEngineHost.js';
const post = (value) => self.postMessage({ ...value, protocol: VIBE_ENGINE_PROTOCOL });
async function load() {
  let base, token, device;
  try {
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
    device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
    device.lost.then((info) => {
      if (info.reason !== 'destroyed')
        post({
          type: 'error',
          code: 'WEBGPU_DEVICE_LOST',
          engine: SKY_DEPLOYMENT,
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
    base = await ort.InferenceSession.create(buffers.base, {
      executionProviders: ['webgpu'],
      preferredOutputLocation: { hidden: 'gpu-buffer', ...preferred(12) },
    });
    delete buffers.base;
    token = await ort.InferenceSession.create(buffers.token, {
      executionProviders: ['webgpu'],
      preferredOutputLocation: { y: 'cpu', ...preferred(3) },
    });
    delete buffers.token;
    const decoder = new SkyDecoder(ort, base, token);
    post({ type: 'initializing', stage: 'warmup' });
    // Session creation does not compile every mobile GPU kernel. Exercise the exact inference path.
    try {
      await decoder.generate(
        skyPrompt(
          [
            { midi: 62, start: 0, duration: 0.5 },
            { midi: 64, start: 0.5, duration: 0.5 },
          ],
          { bpm: 120, count: 1 },
        ),
        { seed: 17 },
      );
    } catch (error) {
      throw new VibeEngineError(
        'MODEL_PREFLIGHT_FAILED',
        `SkyTNT inference self-test failed on this GPU: ${error.message || error}`,
      );
    }
    decoder.persistent = persistent;
    decoder.dispose = async () => {
      try {
        await base.release();
      } finally {
        try {
          await token.release();
        } finally {
          device.destroy();
        }
      }
    };
    return decoder;
  } catch (error) {
    try {
      await base?.release();
    } catch {}
    try {
      await token?.release();
    } catch {}
    device?.destroy();
    throw error;
  }
}
const host = createVibeEngineHost({
  loadTransformer: load,
  generateRules: (request) =>
    generateVibeBars(
      request.notes,
      request.fromBar,
      request.count,
      request.bpm,
      request.key,
      request.seed,
    ),
  generateTransformer: async (decoder, request, { shouldCancel, publish }) => {
    const prompt = skyPrompt(request.notes, request),
      events = [];
    let published = 0;
    const output = await decoder.generate(prompt, {
      seed: request.seed,
      shouldCancel,
      onEvent: ({ event }) => {
        if (shouldCancel()) return;
        events.push(event);
        const completed = skyCompletedBars(prompt, events);
        if (completed.length > published) {
          publish(completed.slice(published));
          published = completed.length;
        }
      },
    });
    return output.bars;
  },
  post,
});
self.onmessage = ({ data }) => void host.handle(data);
