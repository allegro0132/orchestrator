import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTracking, trackPitch, HISTORY_MS } from './tuning.js';
import { detectPitch, frequency } from './pitch.js';
// The tracker consumes unsmoothed measurements from the microphone detector.
const hz = (cents) => 440 * 2 ** (cents / 1200);
const feed = (state, start, end, sample = () => 0, key = 'A4') => {
  for (let t = start; t <= end; t += 100) {
    const c = sample(t);
    state = trackPitch(state, t, c === null ? null : hz(c), 440, key);
  }
  return state;
};
test('requires half a second, then accepts a gently fluctuating sustained tone', () => {
  let state = feed(emptyTracking(), 0, 400, (t) => 3 * Math.sin(t / 220));
  assert.equal(state.success, null);
  assert.ok(state.progress > 0 && state.progress < 1);
  state = feed(state, 500, 600, (t) => 3 * Math.sin(t / 220));
  assert.ok(state.success);
  assert.ok(Math.abs(state.success.mean) < 5);
});
test('crossing the target momentarily does not succeed', () => {
  const state = feed(emptyTracking(), 0, 4000, (t) => ((t % 1000) - 500) / 2);
  assert.equal(state.success, null);
});
test('large oscillation with an accurate average is rejected', () => {
  const state = feed(emptyTracking(), 0, 4000, (t) => (t % 200 ? 35 : -35));
  assert.equal(state.success, null);
  assert.equal(state.progress, 0);
});
test('a stable but sharp tone is rejected', () => {
  assert.equal(feed(emptyTracking(), 0, 4000, () => 30).success, null);
});
test('minor bowing fluctuations and a single brief pitch excursion are tolerated', () => {
  const state = feed(emptyTracking(), 0, 2100, (t) => (t === 900 ? 13 : 2 * Math.sin(t / 180)));
  assert.ok(state.success);
});
test('a short bow change is tolerated but silence never creates success', () => {
  let state = feed(emptyTracking(), 0, 2100, (t) => (t === 300 ? null : 1));
  assert.ok(state.success);
  state = feed(emptyTracking(), 0, 400, () => 0);
  state = feed(state, 500, 2000, () => null);
  assert.equal(state.success, null);
  assert.equal(state.progress, 0);
  assert.equal(state.stats, null);
});
test('a long silence or background pause resets accumulation', () => {
  let state = feed(emptyTracking(), 0, 400);
  state = feed(state, 500, 1100, () => null);
  state = feed(state, 1200, 1600);
  assert.equal(state.success, null);
  assert.ok(state.progress < 1);
  state = feed(state, 1700, 1800);
  assert.ok(state.success);
  state = feed(emptyTracking(), 0, 400);
  state = trackPitch(state, 9000, 440, 440, 'A4');
  assert.equal(state.progress, 0);
  assert.equal(state.success, null);
});
test('sparse or mostly missing measurements cannot succeed', () => {
  let state = emptyTracking();
  for (let t = 0; t < 10000; t += 400) state = trackPitch(state, t, 440, 440, 'A4');
  assert.equal(state.success, null);
  state = feed(emptyTracking(), 0, 4000, (t) => (t % 300 ? 0 : null));
  assert.equal(state.success, null);
});
test('success persists on release; switching target or explicit reset clears it', () => {
  let state = feed(emptyTracking(), 0, 2100);
  const success = state.success;
  state = feed(state, 2200, 8000, () => null);
  assert.deepEqual(state.success, success);
  state = trackPitch(state, 8100, 440, frequency(62), 'D4');
  assert.equal(state.success, null);
  assert.equal(state.samples.length, 1);
  assert.equal(emptyTracking('D4').success, null);
});
test('history is bounded to six seconds and preserves raw pitch excursions', () => {
  const state = feed(emptyTracking(), 0, 12000, (t) => (t === 11900 ? 80 : 0));
  assert.ok(state.samples.every((s) => 12000 - s.time <= HISTORY_MS));
  assert.ok(state.samples.length <= 61);
  assert.ok(state.samples.some((s) => s.cents > 79));
});
test('synthetic bowed harmonics flow through detector into successful tracking', () => {
  let state = emptyTracking();
  for (let t = 0; t <= 2300; t += 100) {
    const f = hz(3 * Math.sin(t / 200));
    const buffer = Float32Array.from(
      { length: 4096 },
      (_, i) =>
        0.3 * Math.sin((2 * Math.PI * f * i) / 48000) +
        0.13 * Math.sin((4 * Math.PI * f * i) / 48000),
    );
    state = trackPitch(state, t, detectPitch(buffer, 48000), 440, 'A4');
  }
  assert.ok(state.success);
});

test('accepts sustained tones throughout the inclusive ±20 cent accuracy zone', () => {
  for (const cents of [-20, -15, 15, 20])
    assert.ok(feed(emptyTracking(), 0, 2200, () => cents).success);
  for (const cents of [-20.1, 20.1])
    assert.equal(feed(emptyTracking(), 0, 2200, () => cents).success, null);
  assert.ok(feed(emptyTracking(), 0, 2200, (t) => 18 * Math.sin(t / 160)).success);
});

test('five well-spaced readings can confirm a 0.5 second hold, but never sooner', () => {
  let state = emptyTracking();
  for (const t of [0, 125, 250, 375]) state = trackPitch(state, t, 440, 440, 'A4');
  assert.equal(state.success, null);
  state = trackPitch(state, 500, 440, 440, 'A4');
  assert.ok(state.success);
  assert.equal(state.success.time, 500);
});

test('each newly sustained note creates one fresh success after release', () => {
  let state = feed(emptyTracking(), 0, 1000);
  const first = state.success.time;
  state = feed(state, 1100, 1500, () => null);
  assert.equal(state.success.time, first);
  state = feed(state, 1600, 2000);
  assert.equal(state.success, null);
  state = feed(state, 2100, 3000);
  assert.equal(state.success.time, 2100);
});
test('moving out of range and returning re-arms without manual reset', () => {
  let state = feed(emptyTracking(), 0, 1000);
  const first = state.success.time;
  state = feed(state, 1100, 1600, () => 50);
  assert.equal(state.success, null);
  state = feed(state, 1700, 2800);
  assert.ok(state.success.time > first);
});
test('continuous success and speaker feedback pauses never create repeated events', () => {
  let state = feed(emptyTracking(), 0, 600);
  const first = state.success.time;
  state = feed(state, 1300, 5000);
  assert.equal(state.success.time, first);
});
test('a brief bow change or pitch excursion does not re-arm the success cue', () => {
  let state = feed(emptyTracking(), 0, 1000);
  const first = state.success.time;
  state = feed(state, 1100, 1200, () => null);
  state = feed(state, 1300, 1600);
  state = feed(state, 1700, 1800, () => 45);
  state = feed(state, 1900, 2500);
  assert.equal(state.success.time, first);
});

test('speaker feedback keeps recording live samples without re-arming the success cue', () => {
  let state = feed(emptyTracking(), 0, 600);
  const success = state.success;
  for (let time = 700; time <= 1200; time += 100) {
    state = trackPitch(state, time, 1046.5, 440, 'A4', { feedbackPlaying: true });
    assert.equal(state.now, time);
    assert.equal(state.samples.at(-1).time, time);
    assert.ok(state.samples.at(-1).cents > 1000);
    assert.deepEqual(state.success, success);
    assert.equal(state.rearmed, false);
  }
  state = feed(state, 1300, 2000);
  assert.deepEqual(state.success, success);
});
