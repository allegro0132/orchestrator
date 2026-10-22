import samples from './violinSamples.json' with { type: 'json' };
import { frequency } from './pitch.js';
const instruments = new WeakMap();
export const violinRoot = (midi) =>
  samples.reduce((best, sample) =>
    Math.abs(sample.midi - midi) < Math.abs(best.midi - midi) ? sample : best,
  );
export function violinInstrument(context, base = import.meta.env?.BASE_URL || '/') {
  if (instruments.has(context)) return instruments.get(context);
  const buffers = new Map(),
    pending = new Map();
  const instrument = {
    async prepare(midis) {
      await Promise.all(
        [...new Set(midis.filter(Number.isFinite).map((midi) => violinRoot(midi).midi))].map(
          async (midi) => {
            if (buffers.has(midi)) return;
            if (!pending.has(midi))
              pending.set(
                midi,
                (async () => {
                  const response = await fetch(`${base}audio/violin/${midi}.wav`, {
                    signal: AbortSignal.timeout(30000),
                  });
                  if (!response.ok) throw new Error('Violin sample download failed');
                  const buffer = await context.decodeAudioData(await response.arrayBuffer());
                  buffers.set(midi, buffer);
                })().finally(() => pending.delete(midi)),
              );
            await pending.get(midi);
          },
        ),
      );
    },
    note(midi, when, duration, reference = 440, offset = 0) {
      const root = violinRoot(midi),
        buffer = buffers.get(root.midi);
      if (!buffer) throw new Error('Violin sample not ready');
      return violinVoice(context, buffer, root, midi, when, duration, reference, offset);
    },
  };
  instruments.set(context, instrument);
  return instrument;
}
export function violinVoice(
  context,
  buffer,
  root,
  midi,
  when,
  duration,
  reference = 440,
  offset = 0,
) {
  const source = context.createBufferSource(),
    gain = context.createGain();
  const rate = frequency(midi, reference) / root.hz;
  const start = Math.max(context.currentTime, when),
    end = start + Math.max(0.02, duration);
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.loop = true;
  source.loopStart = root.loopStart;
  source.loopEnd = root.loopEnd;
  let sampleOffset = offset * rate;
  if (sampleOffset >= root.loopEnd)
    sampleOffset =
      root.loopStart + ((sampleOffset - root.loopStart) % (root.loopEnd - root.loopStart));
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.26, start + Math.min(0.035, duration / 3));
  gain.gain.setValueAtTime(0.26, end);
  gain.gain.linearRampToValueAtTime(0, end + 0.025);
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  source.start(start, sampleOffset);
  source.stop(end + 0.03);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.005);
      source.stop(now + 0.025);
    },
  };
}
// Schedule against the AudioContext clock; UI paints never determine note timing.
export function createViolinTransport(
  context,
  instrument,
  events,
  duration,
  reference = 440,
  { onEnd = () => {}, setTimer = setInterval, clearTimer = clearInterval } = {},
) {
  const notes = events
    .filter((e) => e.midi !== null && e.end > e.start)
    .toSorted((a, b) => a.start - b.start);
  const voices = new Set();
  let running = false,
    origin = 0,
    offset = 0,
    index = 0,
    timer;
  const position = () =>
    Math.min(duration, Math.max(offset, running ? context.currentTime - origin + offset : offset));
  const pause = () => {
    offset = position();
    running = false;
    clearTimer(timer);
    for (const voice of voices) voice.stop();
    voices.clear();
    return offset;
  };
  const pump = () => {
    if (!running) return;
    const time = position();
    if (time >= duration) {
      pause();
      onEnd();
      return;
    }
    while (index < notes.length && notes[index].start < time + 0.15) {
      const e = notes[index++];
      if (e.end <= time) continue;
      const begin = Math.max(time, e.start),
        delay = begin - time;
      const voice = instrument.note(
        e.midi,
        context.currentTime + delay,
        e.end - begin,
        reference,
        begin - e.start,
      );
      voices.add(voice);
      // Drop expired handles without creating a timer per note.
      voice.end = e.end;
    }
    for (const voice of voices) if (voice.end < time - 0.05) voices.delete(voice);
  };
  return {
    position,
    pause,
    stop() {
      pause();
      offset = 0;
    },
    play(at = offset) {
      pause();
      offset = Math.max(0, Math.min(duration, at));
      origin = context.currentTime;
      index = notes.findIndex((e) => e.end > offset);
      if (index < 0) index = notes.length;
      running = true;
      pump();
      if (running) timer = setTimer(pump, 25);
    },
  };
}
