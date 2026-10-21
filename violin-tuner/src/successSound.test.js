import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playSuccessSound } from './successSound.js';
function fakeContext() {
  const tones = [],
    ramps = [];
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    createOscillator() {
      const tone = {
        frequency: { value: 0 },
        connect() {},
        disconnect() {},
        start(t) {
          this.startTime = t;
        },
        stop(t) {
          this.stopTime = t;
        },
      };
      tones.push(tone);
      return tone;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime(...args) {
            ramps.push(args);
          },
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    },
  };
  return { context, tones, ramps };
}
test('plays a short gentle rising cue with finite stops and cleanup', () => {
  const { context, tones, ramps } = fakeContext();
  assert.equal(playSuccessSound(context), 0.42);
  assert.equal(tones.length, 2);
  assert.ok(tones[1].frequency.value > tones[0].frequency.value);
  assert.equal(tones[0].startTime, 10);
  assert.equal(tones[1].startTime, 10.12);
  for (const tone of tones) {
    assert.ok(tone.stopTime <= 10.42);
    assert.equal(typeof tone.onended, 'function');
    tone.onended();
  }
  assert.ok(ramps.every(([level]) => level <= 0.07));
});
test('unavailable or blocked audio does not break the tuner', () => {
  assert.equal(playSuccessSound(null), 0);
  assert.equal(playSuccessSound({ state: 'suspended' }), 0);
  assert.equal(
    playSuccessSound({
      state: 'running',
      createOscillator() {
        throw new Error('blocked');
      },
    }),
    0,
  );
});
