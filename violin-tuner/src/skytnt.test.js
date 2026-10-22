import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SKY_MODEL,
  SKY_PARAMETERS,
  skyEncode,
  skyDecode,
  skyPrompt,
  skyAllowed,
  skyAccept,
  skyBars,
} from './skytnt.js';
import { vibeTrack } from './vibe.js';
const melody = [62, 64, 66, 69].map((midi, i) => ({ midi, start: i, duration: 1 }));
test('SkyTNT V2 token IDs match the pinned upstream tokenizer, including quarter-relative time1', () => {
  const fixtures = [
    ['note', [0, 0, 1, 0, 64, 80, 16], [3, 9, 137, 2202, 2329, 2409, 2553, 169]],
    ['note', [2, 8, 1, 0, 76, 80, 8], [3, 11, 145, 2202, 2329, 2421, 2553, 161]],
    ['time_signature', [0, 0, 0, 3, 1], [7, 9, 137, 2201, 3372, 3386, 0, 0]],
    ['set_tempo', [0, 0, 0, 60], [6, 9, 137, 2201, 3045, 0, 0, 0]],
    ['patch_change', [0, 0, 1, 0, 40], [4, 9, 137, 2202, 2329, 2641, 0, 0]],
    ['key_signature', [0, 0, 0, 9, 0], [8, 9, 137, 2201, 3398, 3404, 0, 0]],
  ];
  for (const [name, values, tokens] of fixtures) {
    assert.deepEqual(skyEncode(name, values), tokens);
    assert.equal(skyDecode(tokens).name, name);
  }
  assert.equal(SKY_PARAMETERS.mi.start + SKY_PARAMETERS.mi.size, 3406);
  assert.throws(() => skyEncode('note', [0, 0, 1, 0, 128, 80, 16]));
  assert.throws(() => skyDecode([3, 0, 0, 0, 0, 0, 0, 0]));
});
test('recognized notes become a bounded, quantized monophonic violin primer without altering original pitches', () => {
  const notes = [
    { midi: 90, start: 0, duration: 1 },
    { midi: 62, start: 1.5, duration: 1 },
    { midi: 64, start: 2.5, duration: 1 },
  ];
  const before = structuredClone(notes),
    p = skyPrompt(notes, { bpm: 120, count: 2 });
  assert.deepEqual(notes, before);
  assert.equal(p.context[0].midi, 90);
  assert.equal(p.context[1].beat, 3);
  assert.equal(p.startTick % 64, 0);
  assert.equal(p.endTick - p.startTick, 128);
  const many = skyPrompt(
    Array.from({ length: 500 }, (_, i) => ({ midi: 62, start: i, duration: 1 })),
    {},
  );
  assert.ok(
    many.context.length <= 64 && many.context.at(-1).beat + many.context.at(-1).duration <= 32,
  );
  const held = skyPrompt([{ midi: 62, start: 0, duration: 600 }], {});
  assert.equal(held.context[0].duration, 32);
  assert.throws(() => skyPrompt([]));
  assert.throws(() => skyPrompt(melody, { count: 0 }));
  assert.throws(() => skyPrompt(melody, { minMidi: 90, maxMidi: 55 }));
});
test('decoding masks force a single violin line, bounded pitches, no overlap and exact requested bars', () => {
  for (const count of [1, 2, 4]) {
    const p = skyPrompt(melody, { count, fromBar: 12, minMidi: 55, maxMidi: 98 });
    const events = [];
    while (p.cursor < p.endTick) {
      const row = [];
      for (let i = 0; i < 8; i++) {
        const allowed = skyAllowed(p, row);
        // Earliest legal onset, highest legal pitch, shortest legal duration.
        row.push(i === 5 ? allowed.at(-1) : allowed[0]);
      }
      events.push(skyAccept(p, row));
    }
    assert.equal(events.length, count * 8);
    assert.ok(events.every((e) => e.midi === 98));
    const bars = skyBars(p, events);
    assert.equal(bars.length, count);
    assert.equal(bars[0].bar, 12);
    assert.equal(
      bars.at(-1).events.at(-1).beat + bars.at(-1).events.at(-1).duration,
      (12 + count) * 4,
    );
    assert.ok(bars.every((b) => b.events.reduce((sum, e) => sum + e.duration, 0) === 4));
    assert.ok(
      vibeTrack(
        bars.flatMap((b) => b.events),
        60,
      ).events.length,
    );
  }
});
test('independent validation rejects out-of-range, overlapping and out-of-window notes; fills silence as rests', () => {
  const p = skyPrompt(melody, { count: 2 });
  const first = skyEncode('note', [1, 0, 1, 0, 62, 80, 16]);
  assert.equal(skyAccept(p, first).beat, 4);
  assert.throws(
    () => skyAccept(p, skyEncode('note', [0, 0, 1, 0, 62, 80, 16])),
    'cannot repeat the same onset over an existing note',
  );
  const start = p.startTick / 16;
  for (const events of [
    [{ midi: 54, beat: start, duration: 1 }],
    [{ midi: 62, beat: start - 1, duration: 1 }],
    [{ midi: 62, beat: start, duration: 9 }],
    [
      { midi: 62, beat: start, duration: 2 },
      { midi: 64, beat: start + 1, duration: 1 },
    ],
  ])
    assert.throws(() => skyBars(p, events));
  const bars = skyBars(p, [{ midi: 62, beat: start + 1, duration: 1 }]);
  assert.equal(bars[0].events[0].midi, null);
  assert.equal(
    bars[1].events.reduce((sum, e) => sum + e.duration, 0),
    4,
  );
});
test('real pretrained-weight evaluation keeps all six constrained continuations legal and versioned', () => {
  const report = JSON.parse(
    readFileSync(new URL('../evaluations/skytnt/results/benchmark.json', import.meta.url)),
  );
  assert.deepEqual(report.model, SKY_MODEL);
  const runs = report.results.filter((r) => r.mode === 'constrained');
  assert.equal(runs.length, 6);
  for (const run of runs) {
    assert.equal(run.audit.outOfRange + run.audit.overlaps + run.audit.outsideHorizon, 0);
    assert.equal(run.audit.reachedHorizon, true);
    const prompt = structuredClone(run.prompt);
    const events = run.rows.map((row) => skyAccept(prompt, row));
    assert.deepEqual(events, run.events);
    assert.deepEqual(skyBars(prompt, events), run.bars);
    assert.ok(run.bars.every((b) => b.events.reduce((sum, e) => sum + e.duration, 0) === 4));
  }
});
