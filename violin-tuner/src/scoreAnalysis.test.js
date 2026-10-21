import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScoreAnalysis, analyseScore, currentEvent, scoreSummary } from './scoreAnalysis.js';
import { frequency } from './pitch.js';
const events = [
  { start: 0, end: 1, midi: 69 },
  { start: 1, end: 2, midi: 71 },
  { start: 2, end: 3, midi: null },
  { start: 3, end: 4, midi: 71 },
];
const feed = (state, start, end, hz) => {
  for (let t = start; t < end; t += 1 / 30) analyseScore(state, t, hz);
};
test('records accurate pitch, coverage, rests, and separated note attacks', () => {
  const state = createScoreAnalysis(events);
  feed(state, 0, 1, 440);
  feed(state, 1, 2, frequency(71));
  feed(state, 2, 3, null);
  feed(state, 3, 4, frequency(71));
  const summary = scoreSummary(state);
  assert.equal(summary.pitch, 100);
  assert.ok(summary.coverage > 90);
  assert.equal(summary.rhythm, 100);
  assert.equal(summary.onsets, 3);
  assert.equal(summary.restNoise, 0);
});
test('wrong notes lower pitch accuracy while timing is measured independently', () => {
  const state = createScoreAnalysis(events);
  feed(state, 0, 1, frequency(70));
  assert.equal(scoreSummary(state, 1).pitch, 0);
  assert.equal(scoreSummary(state, 1).rhythm, 100);
});
test('does not invent an onset for repeated legato pitches', () => {
  const state = createScoreAnalysis([
    { start: 0, end: 1, midi: 69 },
    { start: 1, end: 2, midi: 69 },
  ]);
  feed(state, 0, 2, 440);
  assert.equal(state.results[0].onset, 0);
  assert.equal(state.results[1].onset, null);
  assert.equal(scoreSummary(state).onsets, 1);
});
test('measures early and late attacks and does not count silence as coverage', () => {
  const state = createScoreAnalysis(events);
  feed(state, 0, 0.25, null);
  feed(state, 0.25, 0.9, 440);
  feed(state, 0.9, 1.8, frequency(71));
  feed(state, 1.8, 4, null);
  assert.ok(state.results[0].onset > 0.2);
  assert.ok(state.results[1].onset < 0);
  assert.ok(scoreSummary(state).coverage < 60);
});
test('start-bar range excludes earlier notes; long gaps cannot inflate played duration', () => {
  const state = createScoreAnalysis(events, 3);
  analyseScore(state, 3, frequency(71));
  analyseScore(state, 3.9, frequency(71));
  const summary = scoreSummary(state, 4);
  assert.equal(summary.total, 1);
  assert.equal(summary.completed, 1);
  assert.ok(summary.coverage <= 8);
  assert.equal(currentEvent(events, 4), -1);
});
