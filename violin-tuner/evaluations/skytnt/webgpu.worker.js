import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { SkyDecoder } from '../../src/skyDecoder.js';
import { compareSkyChoices } from '../../src/skyPrecision.js';
let active = false;
self.onmessage = async () => {
  if (active) return;
  active = true;
  let base, token, device;
  const started = performance.now(),
    progress = (message) => self.postMessage({ type: 'progress', message });
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter?.features.has('shader-f16')) throw new Error('W4A16 requires WebGPU shader-f16.');
    device = await adapter.requestDevice({
      requiredFeatures: [
        'shader-f16',
        ...(adapter.features.has('timestamp-query') ? ['timestamp-query'] : []),
      ],
    });
    ort.env.webgpu.device = device;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      wasm: new URL(wasmUrl, self.location.href).href,
      mjs: new URL(mjsUrl, self.location.href).href,
    };
    ort.env.logLevel = 'warning';
    progress('Fetching and verifying the converted weights…');
    const response = await fetch('/skytnt-model/manifest.json');
    if (!response.ok) throw new Error('Conversion manifest unavailable');
    const manifest = await response.json();
    if (
      manifest.recipe.activationType !== 'float16' ||
      manifest.recipe.kvType !== 'float16' ||
      !manifest.recipe.lastOutputOnly
    )
      throw new Error('Unsupported model precision contract');
    const buffers = {};
    for (const part of ['base', 'token']) {
      const file = manifest.files[part],
        response = await fetch(`/skytnt-model/${file.name}`);
      if (!response.ok) throw new Error('Converted model unavailable');
      const buffer = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (buffer.byteLength !== file.bytes || hash !== file.sha256)
        throw new Error('Model checksum mismatch');
      buffers[part] = new Uint8Array(buffer);
    }
    const downloadMs = performance.now() - started;
    const preferred = (layers) =>
      Object.fromEntries(
        Array.from({ length: layers }, (_, i) =>
          ['key', 'value'].map((type) => [`present.${i}.${type}`, 'gpu-buffer']),
        ).flat(),
      );
    progress('Creating WebGPU sessions…');
    const loadStarted = performance.now();
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
    const loadMs = performance.now() - loadStarted;
    const reference = await (await fetch('./results/benchmark.json')).json();
    const decoder = new SkyDecoder(ort, base, token);
    const results = [];
    for (const trial of reference.results.filter((r) => r.mode === 'constrained')) {
      progress(`Generating ${trial.fixture}, seed ${trial.seed}…`);
      const output = await decoder.generate(trial.prompt, { seed: trial.seed });
      results.push({ fixture: trial.fixture, seed: trial.seed, ...output });
    }
    progress('Comparing identical event prefixes against the FP32 reference…');
    const baseline = await (await fetch('./results/fp32-choices.json')).json();
    const precision = [],
      before = [],
      after = [];
    let tensorEvidence;
    for (const trial of baseline.cases) {
      const choices = [];
      await decoder.generate(trial.prompt, {
        forcedRows: trial.rows,
        onLogits: (c) => choices.push(c),
        onTensor: (e) => {
          tensorEvidence = e;
        },
      });
      const stats = compareSkyChoices(trial.choices, choices);
      precision.push({ fixture: trial.fixture, seed: trial.seed, ...stats, choices });
      before.push(...trial.choices);
      after.push(...choices);
    }
    await device.queue.onSubmittedWorkDone();
    self.postMessage({
      type: 'done',
      manifest,
      adapterInfo: {
        vendor: adapter.info?.vendor,
        architecture: adapter.info?.architecture,
        description: adapter.info?.description,
      },
      runtime: ort.env.versions,
      userAgent: navigator.userAgent,
      shaderF16: true,
      downloadMs,
      loadMs,
      tensorEvidence,
      precision,
      precisionSummary: compareSkyChoices(before, after),
      results,
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message, stack: error.stack });
  } finally {
    await base?.release();
    await token?.release();
    device?.destroy();
    active = false;
  }
};
