import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictionRequest,
  commitPrediction,
  clearVibeContext,
  vibeDisplayTrack,
} from './vibePrediction.js';
import { newVibeSession, VIBE_KEYS } from './vibe.js';
import { generateVibeBars, RULE_MODEL_ID } from './vibeRules.js';
import { skyPrompt, skyCompletedBars } from './skytnt.js';
const notes = [62, 64, 66, 69].map((midi, i) => ({ midi, start: i, duration: 1 }));
const generated = (r) => generateVibeBars(r.notes, r.fromBar, r.count, r.bpm, r.key, r.seed);
test('streamed chunks append exactly once and keep every published bar immutable', () => {
  const s = newVibeSession(),
    r = predictionRequest(s, notes, 2, RULE_MODEL_ID),
    bars = generated(r);
  for (const b of bars) assert.ok(commitPrediction(s, r, [b], 2, 100));
  const prefix = [...s.bars],
    track = vibeDisplayTrack(s);
  assert.equal(commitPrediction(s, r, bars, 2, 800), false);
  for (let beat = 4; beat <= 32; beat += 4) {
    const request = predictionRequest(s, notes, beat, RULE_MODEL_ID);
    assert.ok(request.fromBar > s.bars.at(-1).bar);
    assert.ok(commitPrediction(s, request, generated(request), beat, 100));
  }
  assert.deepEqual(s.bars.slice(0, 4), prefix);
  for (let i = 0; i < 4; i++) assert.equal(s.bars[i], prefix[i]);
  const next = vibeDisplayTrack(s);
  assert.equal(next.streamId, track.streamId);
  assert.equal(next.windowBeat, track.windowBeat);
  assert.equal(next.measures[0].bar, '2');
  assert.equal(next.streamBars[0], track.streamBars[0]);
});
test('missed inference deadlines leave explicit rests instead of erasing or rewriting history', () => {
  const s = newVibeSession();
  let r = predictionRequest(s, notes, 2);
  assert.ok(commitPrediction(s, r, generated(r), 2, 100));
  const before = [...s.bars];
  r = predictionRequest(s, notes, 20);
  assert.ok(commitPrediction(s, r, generated(r), 20, 100));
  assert.deepEqual(s.bars.slice(0, 4), before);
  assert.equal(s.bars.find((b) => b.bar === 5).missed, true);
  assert.equal(s.bars.find((b) => b.bar === 5).events[0].midi, null);
  assert.equal(s.bars.find((b) => b.bar === 6).bar, 6);
});
test('invalid partial or overlapping measures never enter the immutable score', () => {
  const s = newVibeSession(),
    r = predictionRequest(s, notes, 2),
    bars = generated(r);
  assert.equal(
    commitPrediction(s, r, [{ ...bars[0], events: [{ midi: 62, beat: 4, duration: 3 }] }], 2, 100),
    false,
  );
  assert.equal(s.bars.length, 0);
});
test('clearing context retains the take and notation, clips held notes and rejects pre-reset inference', () => {
  const s = newVibeSession(60, 'D');
  s.notes = notes;
  s.elapsed = 3;
  const old = predictionRequest(s, notes, 2);
  commitPrediction(s, old, generated(old), 2, 100);
  const id = s.id,
    bars = [...s.bars],
    revisions = [...s.revisions];
  clearVibeContext(s);
  assert.equal(s.id, id);
  assert.equal(s.elapsed, 3);
  assert.deepEqual(s.notes, notes);
  assert.deepEqual(s.bars, bars);
  assert.deepEqual(s.revisions, revisions);
  assert.equal(s.contextEpoch, 1);
  assert.equal(s.contextSince, 3);
  assert.equal(predictionRequest(s, notes.slice(0, 3), 8), null);
  assert.equal(commitPrediction(s, old, generated(old), 2, 200), false);
  const held = [...notes, { midi: 72, start: 2.5, duration: 2.5 }];
  const request = predictionRequest(s, held, 8);
  assert.ok(request.notes.every((n) => n.start >= 3));
  assert.equal(request.notes.find((n) => n.midi === 72).duration, 2);
  assert.ok(!request.notes.some((n) => n.start > 5), 'pre-reset generated bridge was excluded');
  assert.equal(s.contextResets.length, 1);
});
test('SkyTNT streaming publishes only completed measures, never padded provisional notes', () => {
  const p = skyPrompt(notes, { bpm: 60, count: 4, fromBar: 5, key: VIBE_KEYS[0] });
  const beat = p.startTick / 16,
    events = [{ midi: 62, beat, duration: 2 }];
  assert.deepEqual(skyCompletedBars(p, events), []);
  events.push({ midi: 64, beat: beat + 2, duration: 2 });
  const first = skyCompletedBars(p, events);
  assert.equal(first.length, 1);
  assert.equal(first[0].bar, 5);
  events.push({ midi: 66, beat: beat + 5, duration: 3 });
  const second = skyCompletedBars(p, events);
  assert.equal(second.length, 2);
  assert.deepEqual(second[0], first[0]);
  assert.equal(second[1].events[0].midi, null);
});

test('canceling SkyTNT releases GPU cache placeholders without starting more inference', async () => {
  const { SkyDecoder } = await import('./skyDecoder.js');
  const tensors = [];
  class Tensor {
    constructor() {
      this.disposed = false;
      tensors.push(this);
    }
    dispose() {
      this.disposed = true;
    }
  }
  const decoder = new SkyDecoder(
    { Tensor },
    {
      run() {
        throw Error('must not run');
      },
    },
    {},
  );
  const request = skyPrompt(notes, { count: 1 });
  await assert.rejects(() => decoder.generate(request, { shouldCancel: () => true }), {
    name: 'AbortError',
  });
  assert.equal(tensors.length, 24);
  assert.ok(tensors.every((t) => t.disposed));
});
