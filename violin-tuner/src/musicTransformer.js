// Compact causal decoder with learned relative keys. Weights use PyTorch row-major layout.
export const MODEL_ID = 'arco-mt-v1';
export const DURATIONS = [0.5, 1, 1.5, 2, 3, 4];
export function encodeNote(midi, duration) {
  if (midi !== null) {
    midi = Math.round(midi);
    while (midi < 55) midi += 12;
    while (midi > 83) midi -= 12;
  }
  let rhythm = 0;
  for (let i = 1; i < DURATIONS.length; i++)
    if (Math.abs(DURATIONS[i] - duration) < Math.abs(DURATIONS[rhythm] - duration)) rhythm = i;
  return 1 + (midi === null ? 29 : midi - 55) * 6 + rhythm;
}
export function decodeNote(token) {
  if (!Number.isInteger(token) || token < 1 || token > 180) throw new Error('Invalid music token');
  const pitch = Math.floor((token - 1) / 6);
  return { midi: pitch === 29 ? null : pitch + 55, duration: DURATIONS[(token - 1) % 6] };
}
export function performanceTokens(notes, bpm) {
  const events = [];
  let end = 0;
  for (const note of notes) {
    const start = (note.start * bpm) / 60;
    if (start - end >= 0.5) events.push(encodeNote(null, start - end));
    events.push(encodeNote(note.midi, (note.duration * bpm) / 60));
    end = start + (note.duration * bpm) / 60;
  }
  return [0, ...events].slice(-64);
}
function linear(x, weight, bias) {
  const out = new Float32Array(bias);
  for (let i = 0; i < out.length; i++) {
    let sum = out[i],
      offset = i * x.length;
    for (let j = 0; j < x.length; j++) sum += x[j] * weight[offset + j];
    out[i] = sum;
  }
  return out;
}
function norm(x, weight, bias) {
  let mean = 0,
    variance = 0;
  for (const value of x) mean += value / x.length;
  for (const value of x) variance += (value - mean) ** 2 / x.length;
  const inverse = 1 / Math.sqrt(variance + 1e-5);
  return Float32Array.from(x, (value, i) => (value - mean) * inverse * weight[i] + bias[i]);
}
export class MusicTransformer {
  constructor(metadata, buffer) {
    if (
      metadata.id !== MODEL_ID ||
      buffer.byteLength !== metadata.bytes ||
      JSON.stringify(metadata.config) !==
        JSON.stringify({ width: 64, heads: 4, layers: 2, ff: 128, context: 64, vocab: 181 })
    )
      throw new Error('Unsupported Music Transformer weights');
    this.weights = {};
    for (const [name, tensor] of Object.entries(metadata.tensors))
      this.weights[name] = new Float32Array(buffer, tensor.offset * 4, tensor.length);
    this.reset();
  }
  reset() {
    this.cache = Array.from({ length: 2 }, () => []);
  }
  step(token) {
    if (!Number.isInteger(token) || token < 0 || token > 180)
      throw new Error('Invalid music token');
    const w = this.weights;
    let x = w['embed.weight'].slice(token * 64, (token + 1) * 64);
    for (let layer = 0; layer < 2; layer++) {
      const prefix = `blocks.${layer}.`,
        get = (name) => w[prefix + name];
      const normalized = norm(x, get('norm1.weight'), get('norm1.bias'));
      const qkv = linear(normalized, get('qkv.weight'), get('qkv.bias'));
      const cache = this.cache[layer];
      cache.push({ k: qkv.slice(64, 128), v: qkv.slice(128) });
      if (cache.length > 64) cache.shift();
      const attended = new Float32Array(64),
        relative = get('relative');
      for (let head = 0; head < 4; head++) {
        const scores = cache.map(({ k }, position) => {
          let score = 0;
          const distance = cache.length - 1 - position;
          for (let d = 0; d < 16; d++)
            score +=
              qkv[head * 16 + d] * (k[head * 16 + d] + relative[(head * 64 + distance) * 16 + d]);
          return score / 4;
        });
        const max = Math.max(...scores),
          probabilities = scores.map((s) => Math.exp(s - max)),
          total = probabilities.reduce((a, b) => a + b, 0);
        cache.forEach(({ v }, i) => {
          for (let d = 0; d < 16; d++)
            attended[head * 16 + d] += (probabilities[i] / total) * v[head * 16 + d];
        });
      }
      const projected = linear(attended, get('proj.weight'), get('proj.bias'));
      x = Float32Array.from(x, (value, i) => value + projected[i]);
      const hidden = linear(
        norm(x, get('norm2.weight'), get('norm2.bias')),
        get('fc1.weight'),
        get('fc1.bias'),
      );
      for (let i = 0; i < hidden.length; i++) {
        const v = hidden[i];
        hidden[i] = 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3)));
      }
      const ff = linear(hidden, get('fc2.weight'), get('fc2.bias'));
      x = Float32Array.from(x, (value, i) => value + ff[i]);
    }
    return linear(norm(x, w['norm.weight'], w['norm.bias']), w['head.weight'], w['head.bias']);
  }
}
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
// Constraints only mask illegal events. Note/rhythm probabilities come from learned logits.
export function sampleNote(logits, remaining, key, random, previous = null) {
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const allowed = [];
  for (let token = 1; token <= 180; token++) {
    const note = decodeNote(token);
    if (note.duration > remaining + 1e-6) continue;
    if (note.midi !== null && !steps.includes((note.midi - key.tonic + 120) % 12)) continue;
    if (note.midi === null && previous === null) continue;
    if (!Number.isFinite(logits[token])) throw new Error('Non-finite model output');
    allowed.push({ token, score: logits[token] / 0.85 });
  }
  allowed.sort((a, b) => b.score - a.score);
  const candidates = allowed.slice(0, 8),
    max = candidates[0].score;
  const weights = candidates.map((c) => Math.exp(c.score - max));
  let threshold = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    threshold -= weights[i];
    if (threshold <= 0) return candidates[i].token;
  }
  return candidates.at(-1).token;
}
export function predictBars(model, { tokens, fromBar, count, key, seed }) {
  if (
    !tokens.length ||
    !Number.isInteger(fromBar) ||
    fromBar < 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 4 ||
    !Number.isFinite(key?.tonic)
  )
    throw new Error('Invalid prediction request');
  model.reset();
  let logits;
  for (const token of tokens.slice(-64)) logits = model.step(token);
  const random = seededRandom(seed),
    bars = [];
  let previous = decodeNote(tokens.at(-1) || 1).midi;
  for (let bar = fromBar; bar < fromBar + count; bar++) {
    const events = [];
    let remaining = 4;
    while (remaining > 0) {
      const token = sampleNote(logits, remaining, key, random, previous);
      const event = decodeNote(token);
      events.push({ ...event, beat: bar * 4 + 4 - remaining });
      remaining -= event.duration;
      previous = event.midi;
      logits = model.step(token);
    }
    bars.push({ bar, key: key.id, events });
  }
  return bars;
}
