import { HISTORY_MS, MAX_GAP_MS } from './tuning.js';

export function historyPlot(samples, now) {
  const visible = samples.filter((s) => now - s.time <= HISTORY_MS && s.time <= now);
  const range = 50;
  const y = (cents) => 54 - (Math.max(-range, Math.min(range, cents)) / range) * 38;
  const segments = [];
  let segment = [],
    previous = null;
  for (const sample of visible) {
    if (!Number.isFinite(sample.cents) || (previous && sample.time - previous.time > MAX_GAP_MS)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (Number.isFinite(sample.cents)) {
      segment.push({
        x: 12 + (1 - (now - sample.time) / HISTORY_MS) * 456,
        y: y(sample.cents),
        overflow: Math.abs(sample.cents) > range,
      });
    }
    previous = sample;
  }
  if (segment.length) segments.push(segment);
  const current = visible.at(-1);
  return {
    range,
    segments,
    y,
    current: Number.isFinite(current?.cents)
      ? { x: 12 + (1 - (now - current.time) / HISTORY_MS) * 456, y: y(current.cents) }
      : null,
  };
}
