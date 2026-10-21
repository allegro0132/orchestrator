import { STRINGS, PATTERNS, frequency, centsOff } from './pitch.js';
const OFFSETS = [0, 2, 4, 5, 7];
export function findTarget(
  hz,
  { mode, reference = 440, string = 2, finger = 0, position = 0, pattern = 0 },
) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const candidates = STRINGS.flatMap((s, i) =>
    (mode === 'finger' ? [0, 1, 2, 3, 4] : [0]).map((f) => {
      const midi = s.midi + (f ? OFFSETS[position] + PATTERNS[pattern].steps[f - 1] : 0);
      return { string: i, finger: f, distance: Math.abs(centsOff(hz, frequency(midi, reference))) };
    }),
  );
  // A microphone cannot distinguish unisons: prefer the current string / finger.
  candidates.sort((a, b) =>
    Math.abs(a.distance - b.distance) > 0.001
      ? a.distance - b.distance
      : (a.string === string ? 0 : 1) - (b.string === string ? 0 : 1) ||
        (a.finger === finger ? 0 : 1) - (b.finger === finger ? 0 : 1),
  );
  return candidates[0].distance < (mode === 'finger' ? 45 : 350) ? candidates[0] : null;
}
export function advanceTarget(pending, candidate, current, time) {
  if (
    !candidate ||
    (candidate.string === current.string &&
      (current.mode === 'open' || candidate.finger === current.finger))
  )
    return { pending: null, target: null };
  const key = `${candidate.string}:${candidate.finger}`;
  const next =
    pending?.key === key && time - pending.last <= 250
      ? { ...pending, count: pending.count + 1, last: time }
      : { key, count: 1, last: time };
  return { pending: next, target: next.count >= 3 ? candidate : null };
}
