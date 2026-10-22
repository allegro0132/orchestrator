import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequency } from './pitch.js';
import { parseMusicXml } from './score.js';
import {
  createCapture,
  capturePitch,
  captureNotes,
  estimateVibeKey,
  quantizePerformance,
  vibeXml,
} from './vibe.js';
test('transcribes a stable bowed melody while tolerating vibrato and excluding short glitches', () => {
  const capture = createCapture();
  for (let i = 0; i < 30; i++)
    capturePitch(capture, i / 30, frequency(62) * 2 ** ((Math.sin(i) * 25) / 1200));
  capturePitch(capture, 1, frequency(74));
  for (let i = 31; i < 60; i++) capturePitch(capture, i / 30, frequency(62));
  for (let i = 60; i < 90; i++) capturePitch(capture, i / 30, frequency(64));
  const notes = captureNotes(capture, 3, true);
  assert.deepEqual(
    notes.map((n) => n.midi),
    [62, 64],
  );
  assert.ok(notes[0].duration > 1.8);
  assert.ok(Math.abs(notes[0].hz - frequency(62)) < 2);
});
test('silence creates a real gap and separate repeated notes without creating notes from noise', () => {
  const capture = createCapture();
  for (let i = 0; i < 20; i++) capturePitch(capture, i / 30, frequency(69));
  for (let i = 20; i < 40; i++) capturePitch(capture, i / 30, null);
  for (let i = 40; i < 60; i++) capturePitch(capture, i / 30, frequency(69));
  const notes = captureNotes(capture, 2, true);
  assert.equal(notes.length, 2);
  assert.ok(notes[1].start - (notes[0].start + notes[0].duration) > 0.4);
  const silence = createCapture();
  for (let i = 0; i < 300; i++) capturePitch(silence, i / 30, null);
  assert.deepEqual(captureNotes(silence, 10, true), []);
});
test('recording retains high violin notes even when suggested phrases use a comfortable lower range', () => {
  const capture = createCapture();
  for (let i = 0; i < 20; i++) capturePitch(capture, i / 30, frequency(90));
  assert.equal(captureNotes(capture, 1, true)[0].midi, 90);
});
test('pause discards an unconfirmed transition so resuming cannot backdate a new note', () => {
  const capture = createCapture();
  for (let i = 0; i < 30; i++) capturePitch(capture, i / 30, frequency(62));
  capturePitch(capture, 1, frequency(64));
  capturePitch(capture, 1.03, frequency(64));
  captureNotes(capture, 1.05, true);
  assert.equal(capture.candidate, null);
  for (let i = 0; i < 20; i++) capturePitch(capture, 1.1 + i / 30, frequency(64));
  const notes = captureNotes(capture, 1.8, true);
  assert.equal(notes.length, 2);
  assert.ok(notes[1].start >= notes[0].start + notes[0].duration);
});
test('estimates the key from recent performed pitches and durations', () => {
  assert.equal(
    estimateVibeKey([
      { midi: 62, duration: 4 },
      { midi: 66, duration: 2 },
      { midi: 73, duration: 2 },
    ]).id,
    'D',
  );
});
test('performed and generated MusicXML retain separate pitches, quantized rests and tied durations', () => {
  const notes = quantizePerformance(
    [
      { midi: 62, start: 0.1, duration: 2.7 },
      { midi: 64, start: 4.2, duration: 1.9 },
    ],
    60,
  );
  const track = parseMusicXml(vibeXml(notes, 60, 'Performed melody', 'D', 8)).tracks[0];
  assert.equal(track.events[0].duration, 2.5);
  assert.ok(track.events.some((e) => e.midi === null && e.duration > 0));
  const tied = parseMusicXml(vibeXml([{ midi: 69, beat: 3, duration: 3 }], 60)).tracks[0];
  assert.equal(tied.events.find((e) => e.midi === 69).duration, 3);
  const bars = Array.from({ length: 4 }, (_, i) => ({
    events: [{ midi: 62 + i, beat: (i + 1) * 4, duration: 4 }],
  }));
  const generated = parseMusicXml(
    vibeXml(
      bars.flatMap((b) => b.events),
      60,
      'Generated continuation',
    ),
  ).tracks[0];
  assert.equal(generated.measures.length, 5);
  assert.equal(generated.events[0].midi, null);
  assert.equal(generated.duration, 20);
  const window = parseMusicXml(
    vibeXml([{ midi: 70, beat: 0, duration: 4 }], 60, 'Live window', 'Dm', 0, 12),
  ).tracks[0];
  assert.equal(window.measures[0].bar, '13');
  assert.equal(window.events[0].midi, 70);
  assert.match(window.measures[0].xml, /<step>B<\/step><alter>-1<\/alter>/);
});
