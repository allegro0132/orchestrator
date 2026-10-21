import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioContext, ANALYSIS_INTERVAL_MS, AUDIO_SAMPLE_RATE } from './audioConfig.js';
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
  assert.ok(ANALYSIS_INTERVAL_MS < 34);
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
  for (const time of [0, 34, 68, 102, 136, 170]) {
    const result = advanceTarget(pending, target, current, time);
    pending = result.pending;
    assert.equal(result.target, null);
  }
  assert.ok(advanceTarget(pending, target, current, 204).target);
});
