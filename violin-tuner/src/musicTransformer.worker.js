import { MusicTransformer, predictBars } from './musicTransformer.js';
let model;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      // Vite copies public assets under BASE_URL for project-site deployments.
      const root = new URL(`${import.meta.env.BASE_URL}models/`, self.location.origin);
      const response = await fetch(new URL('arco-mt-v1.json', root));
      if (!response.ok) throw new Error('Model metadata download failed');
      const metadata = await response.json();
      const weights = await fetch(new URL('arco-mt-v1.bin', root));
      if (!weights.ok) throw new Error('Model download failed');
      const buffer = await weights.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      if (digest !== metadata.sha256) throw new Error('Model checksum mismatch');
      model = new MusicTransformer(metadata, buffer);
      self.postMessage({ type: 'ready', id: metadata.id, bytes: metadata.bytes });
    } else if (data.type === 'predict') {
      if (!model) throw new Error('Model not ready');
      const started = performance.now();
      const bars = predictBars(model, data.request);
      self.postMessage({
        type: 'result',
        id: data.id,
        bars,
        milliseconds: performance.now() - started,
      });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
};
