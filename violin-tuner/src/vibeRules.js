export const RULE_MODEL_ID = 'arco-rules-v1';
const inScale = (midi, key) =>
  (key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).includes(
    (((midi - key.tonic) % 12) + 12) % 12,
  );
function nearest(value, choices) {
  return choices.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
}
export function generateVibeBars(
  notes,
  fromBar,
  count,
  bpm,
  key,
  seed = 1,
  { minMidi = 55, maxMidi = 83 } = {},
) {
  if (!notes.length) return [];
  const scale = Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i).filter((m) =>
    inScale(m, key),
  );
  const motif = notes.slice(-16);
  const degrees = motif.map((n) => scale.indexOf(nearest(n.midi, scale)));
  const rhythms = motif.map((n) => nearest((n.duration * bpm) / 60, [0.5, 1, 2, 4]));
  let degree = degrees.at(-1);
  return Array.from({ length: count }, (_, offset) => {
    const bar = fromBar + offset,
      events = [];
    let beat = bar * 4,
      remaining = 4,
      index = (seed + bar) % motif.length;
    while (remaining > 0) {
      const step =
        degrees.length > 1
          ? degrees[(index + 1) % degrees.length] - degrees[index % degrees.length]
          : 0;
      degree = Math.max(0, Math.min(scale.length - 1, degree + Math.max(-3, Math.min(3, step))));
      const duration = Math.min(remaining, rhythms[index % rhythms.length]);
      let midi = scale[degree];
      if (remaining === duration && bar % 4 === 3)
        midi = nearest(
          midi,
          scale.filter((m) => (m - key.tonic + 12) % 12 === 0),
        );
      degree = scale.indexOf(midi);
      events.push({ midi, beat, duration });
      beat += duration;
      remaining -= duration;
      index++;
    }
    return { bar, key: key.id, events };
  });
}
