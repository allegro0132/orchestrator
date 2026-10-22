import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCURACY_OPTIONS,
  normalizeAccuracy,
  readAccuracy,
  saveAccuracy,
} from './tuningSettings.js';
import { emptyTracking, trackPitch } from './tuning.js';
const hz = (cents) => 440 * 2 ** (cents / 1200);
const feed = (state, tolerance, cents, from = 0, until = 600) => {
  for (let time = from; time <= until; time += 100)
    state = trackPitch(state, time, hz(cents), 440, 'A4', { accuracyCents: tolerance });
  return state;
};
test('tolerance defaults to 20 and survives storage failures or invalid saved values', () => {
  for (const value of [null, undefined, '', 'garbage', 0, -10, 12, 100, Infinity]) {
    assert.equal(normalizeAccuracy(value), 20);
    assert.equal(readAccuracy({ getItem: () => value }), 20);
  }
  const blocked = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.equal(readAccuracy(blocked), 20);
  assert.doesNotThrow(() => saveAccuracy(10, blocked));
});
test('every supported tolerance is persisted and restored', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  for (const tolerance of ACCURACY_OPTIONS) {
    saveAccuracy(tolerance, storage);
    assert.equal(readAccuracy(storage), tolerance);
  }
});
test('selected tolerance changes success, including positive and negative boundary pitches', () => {
  assert.equal(feed(emptyTracking(), 10, 15).success, null);
  assert.ok(feed(emptyTracking(), 20, 15).success);
  assert.equal(feed(emptyTracking(), 30, 35).success, null);
  assert.ok(feed(emptyTracking(), 40, 35).success);
  for (const cents of [-10, 10]) assert.ok(feed(emptyTracking(), 10, cents).success);
});
test('changing tolerance clears old success and accumulation even with an unchanged note key', () => {
  let state = feed(emptyTracking(), 20, 15);
  assert.ok(state.success);
  state = feed(state, 10, 0, 700, 700);
  assert.equal(state.success, null);
  assert.equal(state.samples.length, 1);
  assert.equal(state.progress, 0);
  assert.equal(state.accuracyCents, 10);
  state = feed(state, 10, 0, 800, 1100);
  assert.equal(state.success, null);
  assert.ok(feed(state, 10, 0, 1200, 1200).success);
});
test('success rearming uses the selected tolerance', () => {
  assert.equal(feed(feed(emptyTracking(), 10, 0), 10, 15, 700, 1100).success, null);
  const wide = feed(emptyTracking(), 20, 0);
  assert.equal(feed(wide, 20, 15, 700, 1100).success.time, wide.success.time);
});
