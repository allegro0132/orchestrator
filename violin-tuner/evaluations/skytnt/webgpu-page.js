const status = document.getElementById('status'),
  run = document.getElementById('run'),
  cancel = document.getElementById('cancel'),
  capabilities = document.getElementById('capabilities'),
  result = document.getElementById('result');
let worker, timeout;
const save = document.getElementById('save'),
  summary = document.getElementById('summary');
async function probe() {
  const gpu = navigator.gpu;
  if (!gpu) throw new Error('WebGPU is unavailable in this browser.');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const info = {
    userAgent: navigator.userAgent,
    shaderF16: adapter.features.has('shader-f16'),
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  };
  capabilities.textContent = JSON.stringify(info, null, 2);
  if (!info.shaderF16) throw new Error('This GPU does not support shader-f16; W4A16 cannot run.');
  run.disabled = false;
  status.textContent = 'WebGPU with shader-f16 available. Ready to load models.';
}
probe().catch((error) => {
  status.textContent = error.message;
  capabilities.textContent = JSON.stringify(
    { userAgent: navigator.userAgent, webgpu: !!navigator.gpu },
    null,
    2,
  );
});
run.onclick = () => {
  run.disabled = true;
  cancel.disabled = false;
  save.disabled = true;
  result.textContent = '';
  summary.textContent = '';
  worker = new Worker(new URL('./webgpu.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') status.textContent = data.message;
    if (data.type === 'done' || data.type === 'error') {
      clearTimeout(timeout);
      status.textContent =
        data.type === 'done' ? 'Evaluation complete.' : `Evaluation failed: ${data.message}`;
      save.disabled = data.type !== 'done';
      if (data.type === 'done')
        summary.textContent = JSON.stringify(
          {
            model: data.manifest.id,
            modelMB: (data.manifest.bytes / 1e6).toFixed(1),
            tensorEvidence: data.tensorEvidence,
            precision: data.precisionSummary,
            timingsMs: data.results.map((x) => Math.round(x.totalMs)),
          },
          null,
          2,
        );
      result.textContent = JSON.stringify(data, null, 2);
      if (data.type === 'done')
        void fetch('/skytnt-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      worker.terminate();
      worker = null;
      run.disabled = false;
      cancel.disabled = true;
    }
  };
  worker.onerror = (event) => {
    clearTimeout(timeout);
    status.textContent = `Worker failed: ${event.message}`;
    worker?.terminate();
    worker = null;
    run.disabled = false;
    cancel.disabled = true;
  };
  timeout = setTimeout(() => {
    worker?.terminate();
    worker = null;
    run.disabled = false;
    cancel.disabled = true;
    status.textContent = 'Evaluation timed out; GPU worker released.';
  }, 180000);
  worker.postMessage({ type: 'run' });
};
cancel.onclick = () => {
  clearTimeout(timeout);
  worker?.terminate();
  worker = null;
  run.disabled = false;
  cancel.disabled = true;
  status.textContent = 'Cancelled. Worker released.';
};
window.addEventListener('pagehide', () => {
  clearTimeout(timeout);
  worker?.terminate();
});

document.getElementById('save').onclick = async () => {
  const data = JSON.parse(result.textContent);
  const response = await fetch('/skytnt-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  status.textContent = response.ok ? 'Benchmark saved locally.' : 'Saving failed.';
};
