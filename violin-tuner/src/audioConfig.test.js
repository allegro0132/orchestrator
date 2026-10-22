import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioContext,
  ANALYSIS_INTERVAL_MS,
  AUDIO_SAMPLE_RATE,
  nextAnalysisTime,
} from './audioConfig.js';
import { advanceTarget, findTarget } from './autoTarget.js';
import { frequency } from './pitch.js';
test('requests 48 kHz and falls back only for unsupported sample rates', () => {
  let requested;
  class Supported {
    constructor(options) {
      requested = options;
    }
  }
  createAudioContext(Supported);
  assert.equal(requested.sampleRate, AUDIO_SAMPLE_RATE);
  assert.equal(ANALYSIS_INTERVAL_MS, 1000 / 60);
  let calls = 0;
  class Fallback {
    constructor(options) {
      calls++;
      if (options) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    }
  }
  assert.ok(createAudioContext(Fallback));
  assert.equal(calls, 2);
  assert.throws(
    () =>
      createAudioContext(
        class {
          constructor() {
            throw new Error('device error');
          }
        },
      ),
    /device error/,
  );
});
test('faster pitch updates retain a minimum confirmation time before switching targets', () => {
  const current = { mode: 'finger', reference: 440, string: 2, finger: 1, position: 0, pattern: 0 };
  const target = findTarget(frequency(73), current);
  let pending = null;
  for (let frame = 0; frame <= 10; frame++) {
    const time = frame * ANALYSIS_INTERVAL_MS;
    const result = advanceTarget(pending, target, current, time);
    pending = result.pending;
    assert.equal(result.target, null);
  }
  assert.ok(advanceTarget(pending, target, current, 11 * ANALYSIS_INTERVAL_MS).target);
});

test('analysis runs every 60 Hz frame despite sub-millisecond timestamp jitter', () => {
  let previous = -Infinity,
    count = 0;
  for (let frame = 0; frame < 600; frame++) {
    const timestamp = (frame * 1000) / 60 + Math.sin(frame) * 0.15;
    const next = nextAnalysisTime(previous, timestamp);
    if (next !== null) {
      previous = next;
      count++;
    }
  }
  assert.equal(count, 600);
});
test('analysis stays at 60 Hz on faster screens and never catches up in a burst after stalls', () => {
  for (const [refreshRate, expected] of [
    [120, 600],
    [144, 600],
    [30, 300],
  ]) {
    let previous = -Infinity,
      count = 0;
    for (let frame = 0; frame < refreshRate * 10; frame++) {
      const next = nextAnalysisTime(previous, (frame * 1000) / refreshRate);
      if (next !== null) {
        previous = next;
        count++;
      }
    }
    assert.equal(count, expected);
  }
  const afterStall = nextAnalysisTime(0, 5000);
  assert.ok(Number.isFinite(afterStall));
  assert.equal(nextAnalysisTime(afterStall, 5000), null);
  assert.equal(nextAnalysisTime(afterStall, 5001), null);
  assert.notEqual(nextAnalysisTime(afterStall, 5017), null);
});
