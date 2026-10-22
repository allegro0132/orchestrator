import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, targetMidiFor, readInstrument } from './instruments.js';
import { frequency, detectPitch, centsOff } from './pitch.js';
import { findTarget } from './autoTarget.js';
import { GUITAR_LESSONS } from './guitarLessons.js';
import { lessonScore } from './beginnerLessons.js';
import { newVibeSession, createCapture, capturePitch, captureNotes } from './vibe.js';
import { predictionRequest, commitPrediction } from './vibePrediction.js';
import { generateVibeBars } from './vibeRules.js';
import { skyPrompt, skyDecode } from './skytnt.js';

test('guitar strings and frets use concert pitch, including both E strings', () => {
  assert.deepEqual(
    INSTRUMENTS.guitar.strings.map((s) => s.midi),
    [40, 45, 50, 55, 59, 64],
  );
  assert.equal(targetMidiFor('guitar', 0, 1, 0), 41);
  assert.equal(targetMidiFor('guitar', 5, 4, 11), 79);
  assert.equal(targetMidiFor('guitar', 0, 0, 11), 40);
  assert.equal(targetMidiFor('violin', 1, 2, 0, 0), 66);
  assert.equal(readInstrument({ getItem: () => 'guitar' }), 'guitar');
  assert.equal(readInstrument({ getItem: () => 'unknown' }), 'violin');
  assert.equal(readInstrument({ getItem: () => 'toString' }), 'violin');
  assert.equal(
    readInstrument({
      getItem: () => {
        throw Error();
      },
    }),
    'violin',
  );
});
test('60 Hz detector resolves quiet harmonic guitar tones, including detuned E2', () => {
  for (const rate of [44100, 48000])
    for (const midi of [40, 45, 50, 55, 59, 64, 79])
      for (const detune of [-25, 0, 25]) {
        const hz = frequency(midi) * 2 ** (detune / 1200);
        const buffer = Float32Array.from(
          { length: 4096 },
          (_, i) =>
            0.018 *
            (Math.sin((2 * Math.PI * hz * i) / rate) +
              0.6 * Math.sin((4 * Math.PI * hz * i) / rate) +
              0.25 * Math.sin((6 * Math.PI * hz * i) / rate)),
        );
        const detected = detectPitch(buffer, rate, INSTRUMENTS.guitar.minHz);
        assert.ok(
          detected && Math.abs(centsOff(detected, hz)) < 2,
          `${midi} ${rate} ${detune}: ${detected}`,
        );
      }
  assert.equal(detectPitch(new Float32Array(4096), 48000, 65), null);
});
test('automatic guitar targets distinguish E octaves and keep unisons on selected strings', () => {
  assert.equal(findTarget(frequency(40), { mode: 'open', instrument: 'guitar' }).string, 0);
  assert.equal(findTarget(frequency(64), { mode: 'open', instrument: 'guitar' }).string, 5);
  const result = findTarget(frequency(59), {
    mode: 'finger',
    instrument: 'guitar',
    string: 3,
    finger: 4,
    position: 0,
  });
  assert.equal(result.string, 3);
  assert.equal(result.finger, 4);
});
test('guitar lessons parse as playable single-note scores with no violin bow cues', () => {
  for (const lesson of GUITAR_LESSONS) {
    const score = lessonScore(lesson);
    assert.ok(score.tracks.length);
    assert.equal(lesson.cues.reduce((beats, cue) => beats + cue.beats, 0) % 4, 0);
    assert.ok(
      lesson.cues.every((cue) => cue.midi >= 40 && !cue.bow && cue.string >= 1 && cue.string <= 6),
    );
  }
});
test('guitar capture and both continuation requests retain low notes and guitar range', () => {
  const capture = createCapture();
  for (let i = 0; i < 90; i++) capturePitch(capture, i / 60, frequency(40), 440, 40, 88);
  const notes = captureNotes(capture, 1.5, true);
  assert.equal(notes[0].midi, 40);
  const session = newVibeSession(60, 'auto', 'guitar');
  notes.push({ midi: 45, start: 1.5, duration: 1 });
  const request = predictionRequest(session, notes, 1);
  assert.equal(request.minMidi, 40);
  assert.equal(request.maxMidi, 76);
  assert.equal(request.program, 24);
  const bars = generateVibeBars(
    request.notes,
    request.fromBar,
    request.count,
    request.bpm,
    request.key,
    request.seed,
    request,
  );
  assert.ok(bars.flatMap((b) => b.events).every((e) => e.midi >= 40 && e.midi <= 76));
  assert.ok(commitPrediction(session, request, bars, 1, 1));
  const prompt = skyPrompt(request.notes, request);
  assert.equal(prompt.minMidi, 40);
  assert.ok(prompt.context.some((n) => n.midi === 40));
  assert.ok(
    prompt.rows.slice(1).some((row) => {
      const e = skyDecode(row);
      return e.name === 'patch_change' && e.patch === 24;
    }),
  );
});

test('guitar voice is prepared at the selected tuning and decays without clipping', async () => {
  const { guitarInstrument } = await import('./guitarAudio.js');
  const calls = [],
    buffers = [];
  const context = {
    sampleRate: 24000,
    currentTime: 0,
    destination: {},
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      const buffer = { getChannelData: () => data };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource: () => ({
      connect() {},
      disconnect() {},
      start(...args) {
        calls.push(['start', ...args]);
      },
      stop(...args) {
        calls.push(['stop', ...args]);
      },
    }),
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        cancelScheduledValues() {},
        setTargetAtTime() {},
      },
    }),
  };
  const instrument = guitarInstrument(context);
  await instrument.prepare([40, 40], 442);
  assert.equal(buffers.length, 1);
  const data = buffers[0].getChannelData(0);
  assert.ok(data.every((n) => Number.isFinite(n) && Math.abs(n) < 1));
  assert.ok(
    Math.abs(centsOff(detectPitch(data.slice(12000, 16096), 24000, 65), frequency(40, 442))) < 2,
  );
  const rms = (start) =>
    Math.sqrt(data.slice(start, start + 4096).reduce((n, v) => n + v * v, 0) / 4096);
  assert.ok(rms(100000) < rms(10000) * 0.1);
  const voice = instrument.note(40, 0.1, 2, 442, 0.5);
  voice.stop();
  voice.stop();
  assert.deepEqual(calls[0], ['start', 0.1, 0.5]);
  assert.equal(calls.filter((c) => c[0] === 'stop').length, 2);
});
