import * as ort from 'onnxruntime-node';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import {
  SKY_MODEL,
  SKY_PARAMETERS,
  skyPrompt,
  skyAllowed,
  skyDecode,
  skyAccept,
  skyBars,
} from '../../src/skytnt.js';
import * as MidiLibrary from '@tonejs/midi';
import { seededRandom } from '../../src/musicTransformer.js';
import { parseMusicXml } from '../../src/score.js';
import { vibeXml, createCapture, capturePitch, captureNotes, VIBE_KEYS } from '../../src/vibe.js';
import { frequency } from '../../src/pitch.js';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const modelDir = resolve(positional[0] || '/tmp/arco-skytnt-eval');
const outputDir = resolve(positional[1] || fileURLToPath(new URL('./results', import.meta.url)));
const count = Number(args.find((a) => a.startsWith('--bars='))?.slice(7) || 4);
const minMidi = Number(args.find((a) => a.startsWith('--min-midi='))?.slice(11) || 55);
const maxMidi = Number(args.find((a) => a.startsWith('--max-midi='))?.slice(11) || 83);
const modes = args.includes('--constrained-only')
  ? ['constrained']
  : ['instrument-only', 'constrained'];
mkdirSync(outputDir, { recursive: true });
// Keep optional native-runtime diagnostics in the temporary model cache, outside the repository.
const takePath = args.find((a) => a.startsWith('--take='))?.slice(7);
if (takePath) args[args.findIndex((a) => a.startsWith('--take='))] = `--take=${resolve(takePath)}`;
process.chdir(modelDir);
for (const part of ['base', 'token']) {
  const path = join(modelDir, `model_${part}.onnx`);
  if (!existsSync(path)) throw new Error(`Missing ${path}. See README for pinned download URLs.`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (
    statSync(path).size !== SKY_MODEL.files[part].bytes ||
    hash.digest('hex') !== SKY_MODEL.files[part].sha256
  )
    throw new Error(`Invalid ${part} weights`);
}
const options = {
  executionProviders: ['cpu'],
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  logSeverityLevel: 3,
};
const loadStart = performance.now();
const base = await ort.InferenceSession.create(join(modelDir, 'model_base.onnx'), options);
const token = await ort.InferenceSession.create(join(modelDir, 'model_token.onnx'), options);
const loadMs = performance.now() - loadStart;
const emptyCache = (layers, heads, width) =>
  Object.fromEntries(
    Array.from({ length: layers }, (_, i) =>
      ['key', 'value'].map((type) => [
        `past_key_values.${i}.${type}`,
        new ort.Tensor('float32', new Float32Array(0), [1, heads, 0, width]),
      ]),
    ).flat(),
  );
function updateCache(cache, output) {
  for (const [name, tensor] of Object.entries(output))
    if (name.startsWith('present.')) {
      const input = name.replace('present.', 'past_key_values.');
      cache[input]?.dispose();
      cache[input] = tensor;
    }
}
const releaseCache = (cache) => Object.values(cache).forEach((t) => t.dispose());
const ints = (values, dims) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims);
function sample(logits, allowed, random) {
  const candidates = allowed
    .map((id) => ({ id, score: logits[id] / 0.85 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  if (!candidates.length || candidates.some((c) => !Number.isFinite(c.score)))
    throw new Error('Invalid logits or mask');
  const weights = candidates.map((c) => Math.exp(c.score - candidates[0].score));
  let draw = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    draw -= weights[i];
    if (draw <= 0) return candidates[i].id;
  }
  return candidates.at(-1).id;
}
function rawAllowed(prefix) {
  if (!prefix.length) return [3];
  const parameter = ['time1', 'time2', 'track', 'channel', 'pitch', 'velocity', 'duration'][
    prefix.length - 1
  ];
  const { start, size } = SKY_PARAMETERS[parameter];
  const values =
    parameter === 'track'
      ? [1]
      : parameter === 'channel'
        ? [0]
        : parameter === 'velocity'
          ? [80]
          : Array.from({ length: parameter === 'duration' ? size - 1 : size }, (_, i) =>
              parameter === 'duration' ? i + 1 : i,
            );
  return values.map((n) => start + n);
}
async function generate(request, mode, seed) {
  const state = structuredClone(request),
    random = seededRandom(seed),
    cache = emptyCache(12, 16, 64),
    events = [],
    rows = [],
    latencies = [];
  let input = request.rows,
    firstEventMs,
    prefillMs;
  const started = performance.now();
  try {
    for (let n = 0; n < request.count * 8; n++) {
      const step = performance.now(),
        x = ints(input.flat(), [1, input.length, 8]);
      const baseOutput = await base.run({ x, ...cache });
      x.dispose();
      updateCache(cache, baseOutput);
      if (!n) prefillMs = performance.now() - step;
      const hiddenData = Float32Array.from(baseOutput.hidden.data.slice(-1024));
      baseOutput.hidden.dispose();
      const localCache = emptyCache(3, 4, 256),
        row = [];
      try {
        for (let position = 0; position < 8; position++) {
          const hidden = new ort.Tensor('float32', position ? new Float32Array(0) : hiddenData, [
            1,
            position ? 0 : 1,
            1024,
          ]);
          const tx = ints(position ? [row.at(-1)] : [], [1, position ? 1 : 0]);
          const result = await token.run({ hidden, x: tx, ...localCache });
          hidden.dispose();
          tx.dispose();
          updateCache(localCache, result);
          const allowed = mode === 'constrained' ? skyAllowed(state, row) : rawAllowed(row);
          row.push(sample(result.y.data.slice(-3406), allowed, random));
          result.y.dispose();
        }
      } finally {
        releaseCache(localCache);
      }
      rows.push(row);
      let event;
      if (mode === 'constrained') event = skyAccept(state, row);
      else {
        const decoded = skyDecode(row);
        state.lastT1 += decoded.time1;
        event = {
          midi: decoded.pitch,
          beat: (state.lastT1 * 16 + decoded.time2) / 16,
          duration: decoded.duration / 16,
        };
        state.cursor = (event.beat + event.duration) * 16;
      }
      events.push(event);
      input = [row];
      latencies.push(performance.now() - step);
      if (n === 0) firstEventMs = performance.now() - started;
      if ((mode === 'constrained' ? state.cursor : events.at(-1).beat * 16) >= state.endTick) break;
    }
    const totalMs = performance.now() - started;
    const sorted = [...latencies].sort((a, b) => a - b),
      start = request.startTick / 16,
      end = request.endTick / 16;
    let lastEnd = start,
      overlaps = 0;
    for (const event of events) {
      if (event.beat < lastEnd - 1e-6) overlaps++;
      lastEnd = Math.max(lastEnd, event.beat + event.duration);
    }
    const audit = {
      reachedHorizon: state.cursor >= state.endTick,
      notes: events.length,
      outOfRange: events.filter((e) => e.midi < request.minMidi || e.midi > request.maxMidi).length,
      overlaps,
      outsideHorizon: events.filter((e) => e.beat < start || e.beat + e.duration > end).length,
    };
    const bars = mode === 'constrained' ? skyBars(request, events) : null;
    if (bars)
      for (const bar of bars)
        if (Math.abs(bar.events.reduce((s, e) => s + e.duration, 0) - 4) > 1e-6)
          throw new Error('Incomplete bar');
    return {
      mode,
      seed,
      totalMs,
      prefillMs,
      firstEventMs,
      eventP50Ms: sorted[Math.floor(sorted.length * 0.5)],
      eventP95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      audit,
      events,
      bars,
      rows,
    };
  } finally {
    releaseCache(cache);
  }
}
const fixtures = [];
const takeArg = args.find((a) => a.startsWith('--take='));
if (takeArg) {
  const take = JSON.parse(readFileSync(resolve(takeArg.slice(7)), 'utf8'));
  fixtures.push({
    id: 'vibe-take',
    notes: take.notes,
    bpm: take.bpm,
    key: VIBE_KEYS.find((k) => k.id === (take.estimatedKey || take.key)) || null,
  });
}
for (const id of ['ode', 'minuet']) {
  const track = parseMusicXml(
    readFileSync(new URL(`../../public/scores/${id}.musicxml`, import.meta.url), 'utf8'),
  ).tracks[0];
  fixtures.push({
    id,
    key:
      id === 'minuet' ? { id: 'G', fifths: 1, minor: false } : { id: 'D', fifths: 2, minor: false },
    notes: track.events
      .filter((e) => e.midi !== null)
      .slice(0, 12)
      .map((e) => ({ midi: e.midi, start: e.beat, duration: e.duration })),
  });
}
const capture = createCapture();
for (let i = 0; i < 240; i++)
  capturePitch(
    capture,
    i / 30,
    frequency([62, 64, 66, 69, 67, 66, 64, 62][Math.floor(i / 30)]) *
      2 ** ((Math.sin(i) * 15) / 1200),
  );
fixtures.push({
  id: 'detected-d-melody',
  key: { id: 'D', fifths: 2, minor: false },
  notes: captureNotes(capture, 8, true),
});
const results = [];
try {
  for (const fixture of fixtures)
    for (const seed of [17, 29])
      for (const mode of modes) {
        const prompt = skyPrompt(fixture.notes, {
          bpm: fixture.bpm || 60,
          count,
          minMidi,
          maxMidi,
          key: fixture.key,
        });
        const result = await generate(prompt, mode, seed);
        results.push({ fixture: fixture.id, prompt, ...result });
        if (result.bars) {
          const events = [...prompt.context, ...result.bars.flatMap((b) => b.events)];
          writeFileSync(
            join(outputDir, `${fixture.id}-${seed}.musicxml`),
            vibeXml(
              events,
              prompt.bpm,
              'SkyTNT primer and constrained continuation',
              fixture.key?.id || 'C',
            ),
          );
          const Midi = MidiLibrary.Midi || MidiLibrary.default?.Midi,
            midi = new Midi();
          midi.header.setTempo(prompt.bpm);
          const violin = midi.addTrack();
          violin.instrument.number = 40;
          for (const e of events)
            if (e.midi !== null)
              violin.addNote({
                midi: e.midi,
                time: (e.beat * 60) / prompt.bpm,
                duration: (e.duration * 60) / prompt.bpm,
                velocity: 0.65,
              });
          writeFileSync(join(outputDir, `${fixture.id}-${seed}.mid`), Buffer.from(midi.toArray()));
        }
        console.log(
          JSON.stringify({
            fixture: fixture.id,
            seed,
            mode,
            ms: Math.round(result.totalMs),
            firstMs: Math.round(result.firstEventMs),
            ...result.audit,
          }),
        );
      }
  const report = {
    model: SKY_MODEL,
    runtime: ort.env.versions,
    environment: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      node: process.version,
      threads: 2,
    },
    loadMs,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    settings: {
      bpm: 60,
      bars: count,
      minMidi,
      maxMidi,
      maxGapBeats: 1,
      temperature: 0.85,
      topK: 20,
      seeds: [17, 29],
      timingGrid: 'eighth notes',
      contextLimit: 'last 32 beats / 64 notes',
    },
    results,
  };
  writeFileSync(join(outputDir, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  await base.release();
  await token.release();
}
