import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTarget, advanceTarget } from './autoTarget.js';
import { frequency, STRINGS, PATTERNS } from './pitch.js';
const current = { mode: 'finger', reference: 440, string: 2, finger: 1, position: 0, pattern: 0 };
test('detects every string and finger within the chosen position and pattern', () => {
  for (let position = 0; position < 5; position++)
    for (let pattern = 0; pattern < 4; pattern++)
      for (let string = 0; string < 4; string++)
        for (let finger = 0; finger <= 4; finger++) {
          const config = { ...current, position, pattern, string, finger };
          const midi =
            STRINGS[string].midi +
            (finger ? [0, 2, 4, 5, 7][position] + PATTERNS[pattern].steps[finger - 1] : 0);
          const target = findTarget(frequency(midi, 442), { ...config, reference: 442 });
          assert.equal(target.string, string);
          assert.equal(target.finger, finger);
        }
});
test('switches finger, open string, and string while retaining configured pattern', () => {
  assert.equal(findTarget(frequency(73), current).finger, 2);
  assert.equal(findTarget(440, current).finger, 0);
  assert.equal(findTarget(frequency(67), current).string, 1);
  assert.equal(findTarget(frequency(72), current), null);
  assert.equal(findTarget(null, current), null);
});
test('prefers current string for unisons and waits for three consistent readings', () => {
  const target = findTarget(frequency(76), { ...current, string: 2 });
  assert.equal(target.string, 2);
  assert.equal(target.finger, 4);
  let pending = null;
  for (const time of [0, 100]) {
    const r = advanceTarget(pending, target, current, time);
    pending = r.pending;
    assert.equal(r.target, null);
  }
  assert.ok(advanceTarget(pending, target, current, 200).target);
  assert.equal(advanceTarget(pending, null, current, 200).pending, null);
  assert.equal(advanceTarget(pending, target, current, 600).target, null);
});
