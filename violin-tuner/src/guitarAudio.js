import { frequency } from './pitch.js';
const instruments = new WeakMap();
// A plucked string voice: harmonics decay faster than the fundamental.
export function guitarInstrument(context) {
  if (instruments.has(context)) return instruments.get(context);
  const buffers = new Map();
  function prepareNote(midi, reference) {
    const key = `${midi}:${reference}`;
    if (buffers.has(key)) return;
    const hz = frequency(midi, reference),
      rate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.ceil(rate * 6), rate);
    const data = buffer.getChannelData(0);
    for (let harmonic = 1; harmonic <= 16 && hz * harmonic < rate / 2; harmonic++) {
      const angle = (2 * Math.PI * hz * harmonic) / rate;
      const rotation = Math.cos(angle),
        step = Math.sin(angle);
      const decay = Math.exp(-(0.65 + harmonic * 0.24) / rate);
      let sin = 0,
        cos = 1,
        amplitude = (0.32 * Math.sin(harmonic * Math.PI * 0.23)) / harmonic ** 1.25;
      for (let i = 0; i < data.length; i++) {
        data[i] += amplitude * sin * Math.min(1, i / (rate * 0.004));
        const next = sin * rotation + cos * step;
        cos = cos * rotation - sin * step;
        sin = next;
        amplitude *= decay;
      }
    }
    buffers.set(key, buffer);
  }
  const instrument = {
    async prepare(midis, reference = 440) {
      for (const midi of new Set(midis.filter(Number.isFinite))) {
        prepareNote(midi, reference);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    note(midi, when, duration, reference = 440, offset = 0) {
      const key = `${midi}:${reference}`;
      if (!buffers.has(key)) throw new Error('Guitar voice not prepared');
      const source = context.createBufferSource(),
        gain = context.createGain();
      const start = Math.max(context.currentTime, when),
        end = start + Math.max(0.02, duration);
      source.buffer = buffers.get(key);
      source.connect(gain);
      gain.connect(context.destination);
      gain.gain.setValueAtTime(1, start);
      gain.gain.setValueAtTime(1, end);
      gain.gain.linearRampToValueAtTime(0, end + 0.035);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(start, Math.min(5.9, offset));
      source.stop(end + 0.04);
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
    },
  };
  instruments.set(context, instrument);
  return instrument;
}
