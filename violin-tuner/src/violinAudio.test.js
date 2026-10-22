import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import samples from './violinSamples.json' with { type: 'json' };
import { violinRoot, violinVoice, createViolinTransport } from './violinAudio.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('nearest roots cover the violin register without large transpositions', () => {
  for (let midi = 55; midi <= 96; midi++) assert.ok(Math.abs(violinRoot(midi).midi - midi) <= 4);
  assert.equal(violinRoot(69).midi, 67);
});
test('hosted samples match checksums and contain valid PCM sustain loop regions', () => {
  for (const s of samples) {
    const b = readFileSync(new URL(`../public/audio/violin/${s.midi}.wav`, import.meta.url));
    assert.equal(createHash('sha256').update(b).digest('hex'), s.sha256);
    assert.equal(b.toString('ascii', 0, 4), 'RIFF');
    assert.equal(b.readUInt16LE(22), 1);
    assert.equal(b.readUInt32LE(24), 24000);
    assert.ok(s.loopStart > 0 && s.loopEnd <= (b.length - 44) / 48000);
    assert.ok(Math.abs(1200 * Math.log2(s.hz / (440 * 2 ** ((s.midi - 69) / 12)))) < 30);
  }
});
test('violin playback calibrates recorded pitch to A4 and releases canceled voices', () => {
  const calls = [],
    source = {
      playbackRate: {},
      connect() {},
      disconnect() {
        calls.push('source disconnected');
      },
      start(...a) {
        calls.push(['start', ...a]);
      },
      stop(...a) {
        calls.push(['stop', ...a]);
      },
    };
  const gain = {
    gain: {
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      cancelScheduledValues() {},
      setTargetAtTime() {},
    },
    connect() {},
    disconnect() {
      calls.push('gain disconnected');
    },
  };
  const ctx = {
    currentTime: 10,
    destination: {},
    createBufferSource: () => source,
    createGain: () => gain,
  };
  const root = violinRoot(69),
    voice = violinVoice(ctx, {}, root, 69, 10.1, 4, 442, 8);
  near(source.playbackRate.value, 442 / root.hz);
  assert.equal(source.loop, true);
  const start = calls.find((c) => c[0] === 'start');
  assert.ok(start[2] >= root.loopStart && start[2] < root.loopEnd);
  voice.stop();
  voice.stop();
  assert.equal(calls.filter((c) => c[0] === 'stop').length, 2);
  source.onended();
  assert.ok(calls.includes('gain disconnected'));
});
test('transport schedules rests and precise note times, resumes inside a sustained note and cancels queued voices', () => {
  const context = { currentTime: 0 },
    calls = [],
    voices = [];
  let pump,
    ended = 0;
  const instrument = {
    note(...args) {
      calls.push(args);
      const voice = {
        stops: 0,
        stop() {
          this.stops++;
        },
      };
      voices.push(voice);
      return voice;
    },
  };
  const tr = createViolinTransport(
    context,
    instrument,
    [
      { midi: 62, start: 0, end: 2 },
      { midi: null, start: 2, end: 3 },
      { midi: 64, start: 3, end: 4 },
    ],
    4,
    442,
    {
      setTimer: (f) => {
        pump = f;
        return 1;
      },
      clearTimer: () => {},
      onEnd: () => ended++,
    },
  );
  tr.play(1);
  assert.equal(calls.length, 1);
  near(calls[0][2], 1);
  near(calls[0][4], 1);
  assert.equal(calls[0][3], 442);
  context.currentTime = 0.5;
  near(tr.pause(), 1.5);
  assert.equal(voices[0].stops, 1);
  context.currentTime = 5;
  tr.play(1.5);
  near(calls[1][4], 1.5);
  context.currentTime = 5.6;
  pump();
  assert.equal(calls.length, 2);
  context.currentTime = 6.4;
  pump();
  assert.equal(calls.length, 3);
  near(calls[2][1], 6.5);
  context.currentTime = 7.5;
  pump();
  assert.equal(ended, 1);
  near(tr.position(), 4);
  tr.stop();
  near(tr.position(), 0);
});
