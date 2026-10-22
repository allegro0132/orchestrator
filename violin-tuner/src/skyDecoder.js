import { skyAllowed, skyAccept, skyBars } from './skytnt.js';
import { seededRandom } from './musicTransformer.js';
export function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >> 10) & 31,
    mantissa = bits & 1023;
  return exponent === 31
    ? mantissa
      ? NaN
      : sign * Infinity
    : sign *
        (exponent ? 2 ** (exponent - 15) * (1 + mantissa / 1024) : (2 ** -14 * mantissa) / 1024);
}
export function sampleSkyLogits(values, randomValue) {
  const sorted = values
    .map((score, index) => ({ score: score / 0.85, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  if (!sorted.length || sorted.some((v) => !Number.isFinite(v.score)))
    throw new Error('Invalid model logits');
  const weights = sorted.map((v) => Math.exp(v.score - sorted[0].score));
  let draw = randomValue * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < sorted.length; i++) {
    draw -= weights[i];
    if (draw <= 0) return sorted[i].index;
  }
  return sorted.at(-1).index;
}
export class SkyDecoder {
  constructor(ort, base, token, { dtype = 'float16', lastOutputOnly = true } = {}) {
    Object.assign(this, { ort, base, token, dtype, lastOutputOnly });
  }
  emptyCache(layers, heads, width) {
    return Object.fromEntries(
      Array.from({ length: layers }, (_, i) =>
        ['key', 'value'].map((type) => [
          `past_key_values.${i}.${type}`,
          new this.ort.Tensor(
            this.dtype,
            this.dtype === 'float16' ? new Uint16Array(0) : new Float32Array(0),
            [1, heads, 0, width],
          ),
        ]),
      ).flat(),
    );
  }
  cacheOutputs(cache, outputs) {
    for (const [name, tensor] of Object.entries(outputs))
      if (name.startsWith('present.')) {
        const input = name.replace('present.', 'past_key_values.');
        cache[input]?.dispose();
        cache[input] = tensor;
      }
  }
  release(cache) {
    Object.values(cache).forEach((t) => t.dispose());
  }
  ints(values, dims) {
    return new this.ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims);
  }
  async generate(
    request,
    {
      seed = 17,
      forcedRows = null,
      onLogits = () => {},
      onEvent = () => {},
      onTensor = () => {},
      shouldCancel = () => false,
    } = {},
  ) {
    const state = structuredClone(request),
      cache = this.emptyCache(12, 16, 64),
      random = seededRandom(seed),
      events = [],
      rows = [];
    let input = request.rows,
      firstEventMs,
      prefillMs;
    const started = performance.now();
    try {
      for (let n = 0; n < request.count * 8 && state.cursor < state.endTick; n++) {
        if (shouldCancel()) throw new DOMException('Generation canceled', 'AbortError');
        const x = this.ints(input.flat(), [1, input.length, 8]);
        let baseOutput;
        try {
          baseOutput = await this.base.run({ x, ...cache });
        } finally {
          x.dispose();
        }
        this.cacheOutputs(cache, baseOutput);
        if (!n) prefillMs = performance.now() - started;
        let hidden = baseOutput.hidden;
        if (!this.lastOutputOnly) {
          const original = hidden;
          hidden = new this.ort.Tensor(this.dtype, original.data.slice(-1024), [1, 1, 1024]);
          original.dispose();
        }
        if (!n)
          onTensor({
            hiddenType: hidden.type,
            hiddenLocation: hidden.location,
            cacheType: cache['past_key_values.0.key'].type,
            cacheLocation: cache['past_key_values.0.key'].location,
          });
        const local = this.emptyCache(3, 4, 256),
          row = [];
        let processed = 0,
          hiddenPending = true;
        try {
          for (let position = 0; position < 8; position++) {
            const allowed = skyAllowed(state, row),
              draw = random();
            let chosen = allowed[0];
            // Batch deterministic fields into the next uncertain-token call.
            if (allowed.length > 1) {
              const prefix = row.slice(processed),
                tx = this.ints(prefix, [1, prefix.length]);
              const bridge = hiddenPending
                ? hidden
                : new this.ort.Tensor(
                    this.dtype,
                    this.dtype === 'float16' ? new Uint16Array(0) : new Float32Array(0),
                    [1, 0, 1024],
                  );
              let output;
              try {
                output = await this.token.run({ hidden: bridge, x: tx, ...local });
              } finally {
                tx.dispose();
                if (!hiddenPending) bridge.dispose();
              }
              this.cacheOutputs(local, output);
              const data = output.y.data,
                offset = data.length - 3406;
              const bits = output.y.type === 'float16' && data.constructor.name !== 'Float16Array';
              const logits = allowed.map((id) =>
                bits ? halfToFloat(data[offset + id]) : data[offset + id],
              );
              output.y.dispose();
              if (logits.some((v) => !Number.isFinite(v)))
                throw new Error('Non-finite model logits');
              onLogits({ note: n, position, allowed, logits });
              chosen = allowed[sampleSkyLogits(logits, draw)];
              processed = row.length;
              hiddenPending = false;
            }
            if (forcedRows) {
              chosen = forcedRows[n]?.[position];
              if (!allowed.includes(chosen)) throw new Error('Invalid teacher-forced event');
            }
            row.push(chosen);
          }
        } finally {
          this.release(local);
          hidden.dispose();
        }
        const event = skyAccept(state, row);
        events.push(event);
        rows.push(row);
        input = [row];
        if (!n) firstEventMs = performance.now() - started;
        onEvent({ note: n, event, milliseconds: performance.now() - started });
      }
      if (state.cursor !== state.endTick) throw new Error('Incomplete generated horizon');
      return {
        totalMs: performance.now() - started,
        firstEventMs,
        prefillMs,
        events,
        rows,
        bars: skyBars(request, events),
      };
    } finally {
      this.release(cache);
    }
  }
}
