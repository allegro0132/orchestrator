import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, frequency, centsOff, STRINGS, PATTERNS, noteName } from './pitch.js';
for (const sampleRate of [44100, 48000])
  for (const midi of [55, 62, 69, 76, 83, 90])
    test(`detect MIDI ${midi} at ${sampleRate}`, () => {
      const f = frequency(midi),
        data = Float32Array.from(
          { length: 4096 },
          (_, i) =>
            0.3 * Math.sin((2 * Math.PI * f * i) / sampleRate) +
            0.13 * Math.sin((4 * Math.PI * f * i) / sampleRate) +
            0.06 * Math.sin((6 * Math.PI * f * i) / sampleRate),
        );
      assert.ok(Math.abs(centsOff(detectPitch(data, sampleRate), f)) < 2);
    });
test('silence and quiet noise return null', () => {
  assert.equal(detectPitch(new Float32Array(4096), 48000), null);
  assert.equal(
    detectPitch(
      Float32Array.from({ length: 4096 }, () => Math.random() * 0.002),
      48000,
    ),
    null,
  );
});
test('tuning math and finger intervals', () => {
  assert.equal(frequency(69), 440);
  assert.equal(centsOff(880, 440), 1200);
  assert.equal(noteName(55).name, 'G');
  assert.deepEqual(
    STRINGS.map((s) => s.midi),
    [55, 62, 69, 76],
  );
  PATTERNS.forEach((p) => {
    assert.equal(p.steps.length, 4);
    assert.ok(p.steps.every((n, i) => i === 0 || n > p.steps[i - 1]));
  });
});

for (const midi of [55, 69, 76])
  test(`detect a quiet bowed tone at MIDI ${midi}`, () => {
    const f = frequency(midi),
      data = Float32Array.from(
        { length: 4096 },
        (_, i) =>
          0.004 * Math.sin((2 * Math.PI * f * i) / 48000) +
          0.0015 * Math.sin((4 * Math.PI * f * i) / 48000),
      );
    assert.ok(Math.abs(centsOff(detectPitch(data, 48000), f)) < 2);
  });
test('rejects unpitched noise above the new quiet-sound threshold', () => {
  let seed = 52;
  const data = Float32Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.02;
  });
  assert.equal(detectPitch(data, 48000), null);
});
