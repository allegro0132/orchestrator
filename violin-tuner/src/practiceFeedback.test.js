import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPracticeFeedback,
  advancePracticeFeedback,
  pausePracticeFeedback,
  practiceRecordKey,
  readPracticeRecord,
  savePracticeRecord,
} from './practiceFeedback.js';
import { frequency } from './pitch.js';
const events = [
  { midi: 69, start: 0, end: 1 },
  { midi: 71, start: 1, end: 2 },
  { midi: null, start: 2, end: 3 },
  { midi: 71, start: 3, end: 4 },
];
const feed = (state, from, until, hz, rate = 60) => {
  for (let i = 0; i <= Math.round((until - from) * rate); i++)
    advancePracticeFeedback(state, events, from + i / rate, hz);
  return state;
};
test('hits require a short sustained pitch and a note can only increment combo once', () => {
  const state = createPracticeFeedback(events);
  feed(state, 0, 0.05, 440);
  assert.equal(state.combo, 0);
  feed(state, 0.067, 0.15, 440);
  assert.equal(state.combo, 1);
  assert.equal(state.last.type, 'perfect');
  feed(state, 0.167, 0.95, 440);
  assert.equal(state.combo, 1);
  assert.equal(state.serial, 1);
});
test('a wrong opening can recover, pitch grades use cents and not onset timing', () => {
  const state = createPracticeFeedback(events);
  feed(state, 0, 0.15, frequency(70));
  assert.equal(state.serial, 0);
  feed(state, 0.2, 0.4, 440 * 2 ** (15 / 1200));
  assert.equal(state.last.type, 'good');
  assert.equal(state.combo, 1);
  assert.ok(Math.abs(state.last.cents - 15) < 0.01);
});
test('misses break a streak only at note end; rests preserve a streak and repeats count once each', () => {
  const state = createPracticeFeedback(events);
  feed(state, 0, 0.9, 440);
  feed(state, 1, 1.9, frequency(71));
  assert.equal(state.combo, 2);
  feed(state, 2, 2.9, null);
  assert.equal(state.combo, 2);
  feed(state, 3, 3.2, frequency(71));
  assert.equal(state.combo, 3);
  assert.equal(state.maxCombo, 3);
  assert.equal(state.misses, 0);
  const missed = createPracticeFeedback(events);
  feed(missed, 0, 0.9, 440);
  feed(missed, 1, 1.9, frequency(70));
  assert.equal(missed.combo, 1);
  advancePracticeFeedback(missed, events, 2, null);
  assert.equal(missed.combo, 0);
  assert.equal(missed.maxCombo, 1);
  assert.equal(missed.last.type, 'miss');
  advancePracticeFeedback(missed, events, 2.5, null);
  assert.equal(missed.misses, 1);
});
test('silence, isolated lucky frames and sparse updates cannot generate hits', () => {
  const state = createPracticeFeedback(events);
  for (const time of [0, 0.4, 0.8]) advancePracticeFeedback(state, events, time, 440);
  advancePracticeFeedback(state, events, 1, null);
  assert.equal(state.hits, 0);
  assert.equal(state.misses, 1);
  const spike = createPracticeFeedback(events);
  advancePracticeFeedback(spike, events, 0, 440);
  advancePracticeFeedback(spike, events, 0.017, null);
  advancePracticeFeedback(spike, events, 0.034, frequency(70));
  advancePracticeFeedback(spike, events, 1, null);
  assert.equal(spike.hits, 0);
});
test('seeking excludes prior notes; pause preserves earned combo and clears pending hold time', () => {
  const state = createPracticeFeedback(events, 3);
  feed(state, 3, 3.04, frequency(71));
  assert.equal(state.misses, 0);
  pausePracticeFeedback(state);
  advancePracticeFeedback(state, events, 3.06, frequency(71));
  assert.equal(state.combo, 0);
  feed(state, 3.077, 3.2, frequency(71));
  assert.equal(state.combo, 1);
  pausePracticeFeedback(state);
  assert.equal(state.combo, 1);
  assert.equal(createPracticeFeedback(events, 3).maxCombo, 0);
});
test('completion finalizes all missed notes exactly once even after a stalled frame', () => {
  const state = createPracticeFeedback(events);
  advancePracticeFeedback(state, events, 4, null);
  assert.equal(state.misses, 3);
  assert.equal(state.serial, 3);
  advancePracticeFeedback(state, events, 5, null);
  assert.equal(state.serial, 3);
});
test('reference tuning and short notes use the same sustained-hit policy', () => {
  const fast = [{ midi: 69, start: 0, end: 0.1 }];
  const state = createPracticeFeedback(fast);
  for (let i = 0; i < 5; i++) advancePracticeFeedback(state, fast, i / 60, 442, 442);
  assert.equal(state.hits, 1);
  assert.equal(state.last.type, 'perfect');
});
test('personal best and the last take persist by part without storing audio', () => {
  const data = new Map(),
    storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const track = { id: 'violin:1', name: 'Violin', events: [{ midi: 69, beat: 0, duration: 1 }] };
  const key = practiceRecordKey(track);
  assert.equal(key, practiceRecordKey(structuredClone(track)));
  assert.notEqual(key, practiceRecordKey({ ...track, id: 'violin:2' }));
  const state = createPracticeFeedback(events);
  feed(state, 0, 0.2, 440);
  feed(state, 1, 1.2, frequency(71));
  savePracticeRecord(key, state, storage);
  assert.equal(readPracticeRecord(key, storage).best, 2);
  assert.equal(readPracticeRecord(key, storage).last.hits, 2);
  const next = createPracticeFeedback(events);
  advancePracticeFeedback(next, events, 1, null);
  savePracticeRecord(key, next, storage);
  assert.equal(readPracticeRecord(key, storage).best, 2);
  assert.equal(readPracticeRecord(key, storage).last.misses, 1);
  const blocked = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.equal(readPracticeRecord(key, blocked).best, 0);
  assert.doesNotThrow(() => savePracticeRecord(key, state, blocked));
});
