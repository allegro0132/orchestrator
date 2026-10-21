import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetronome, normalizeMetronome } from './metronome.js';
function fixture() {
  const sounds = [],
    timers = new Map(),
    visuals = new Map();
  let serial = 0;
  const beats = [];
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createOscillator() {
      const node = {
        frequency: {},
        connect() {},
        disconnect() {},
        start(time) {
          this.time = time;
        },
        stop() {
          this.stopped = true;
        },
      };
      sounds.push(node);
      return node;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    },
  };
  const engine = createMetronome(context, {
    onBeat: (beat) => beats.push(beat),
    setIntervalFn: (fn) => {
      timers.set(++serial, fn);
      return serial;
    },
    clearIntervalFn: (id) => timers.delete(id),
    setTimeoutFn: (fn) => {
      visuals.set(++serial, fn);
      return serial;
    },
    clearTimeoutFn: (id) => visuals.delete(id),
  });
  return {
    engine,
    context,
    sounds,
    timers,
    visuals,
    beats,
    pump(time) {
      context.currentTime = time;
      for (const fn of timers.values()) fn();
    },
    flush() {
      for (const fn of [...visuals.values()]) fn();
    },
  };
}
test('schedules accurate beats with a downbeat accent and matching visual counts', () => {
  const f = fixture();
  f.engine.start({ bpm: 120, beats: 4, volume: 40, accent: true });
  for (const time of [0.5, 1, 1.5, 2]) f.pump(time);
  assert.equal(f.sounds.length, 5);
  f.sounds.forEach((node, i) => assert.ok(Math.abs(node.time - (0.04 + i * 0.5)) < 1e-8));
  assert.deepEqual(
    f.sounds.map((s) => s.frequency.value),
    [1400, 900, 900, 900, 1400],
  );
  f.flush();
  assert.deepEqual(f.beats, [0, 1, 2, 3, 0]);
});
test('stopping clears future clicks, visual callbacks, and scheduler timers', () => {
  const f = fixture();
  f.engine.start({ bpm: 80 });
  f.engine.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.visuals.size, 0);
  assert.ok(f.sounds.every((s) => s.stopped));
  f.pump(10);
  f.flush();
  assert.deepEqual(f.beats, []);
});
test('tempo changes cancel old scheduled audio and start a new bar without overlap', () => {
  const f = fixture();
  f.engine.start({ bpm: 40 });
  const first = f.sounds[0];
  f.context.currentTime = 0.2;
  f.engine.update({ bpm: 240, beats: 3, accent: false });
  assert.ok(first.stopped);
  assert.equal(f.timers.size, 1);
  assert.equal(f.sounds[1].frequency.value, 900);
  assert.ok(Math.abs(f.sounds[1].time - 0.24) < 1e-8);
  f.pump(0.45);
  assert.ok(Math.abs(f.sounds[2].time - 0.49) < 1e-8);
});
test('a stalled scheduler skips old beats instead of playing a burst', () => {
  const f = fixture();
  f.engine.start({ bpm: 120 });
  f.pump(10);
  assert.equal(f.sounds.length, 2);
  assert.ok(f.sounds[1].time >= 10);
});
test('settings are bounded and invalid persisted values use safe defaults', () => {
  assert.deepEqual(normalizeMetronome({ bpm: 400, beats: 5, volume: -10 }), {
    bpm: 240,
    beats: 4,
    volume: 0,
    accent: true,
  });
  assert.equal(normalizeMetronome({ bpm: NaN }).bpm, 80);
  assert.equal(normalizeMetronome({ bpm: 1 }).bpm, 40);
});
