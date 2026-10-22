import { centsOff } from './pitch.js';
import { DEFAULT_ACCURACY_CENTS, normalizeAccuracy } from './tuningSettings.js';

export const ACCURACY_CENTS = DEFAULT_ACCURACY_CENTS;
export const HISTORY_MS = 6000;
export const HOLD_MS = 500;
export const MAX_GAP_MS = 300;
const WINDOW_MS = HOLD_MS + 200;

export function emptyTracking(key = '', accuracyCents = ACCURACY_CENTS) {
  return {
    key,
    accuracyCents,
    samples: [],
    now: 0,
    progress: 0,
    stats: null,
    success: null,
    releaseSince: null,
    rearmed: false,
    attemptSince: 0,
  };
}

// Keep raw pitch measurements so smoothing cannot hide an unstable bow stroke.
// All timing uses the animation clock, rather than assuming a fixed sample rate.
export function trackPitch(
  previous,
  time,
  hz,
  target,
  key,
  { feedbackPlaying = false, accuracyCents = ACCURACY_CENTS } = {},
) {
  accuracyCents = normalizeAccuracy(accuracyCents);
  const state =
    previous.key === key && previous.accuracyCents === accuracyCents
      ? previous
      : emptyTracking(key, accuracyCents);
  const cents = Number.isFinite(hz) && hz > 0 ? centsOff(hz, target) : null;
  const samples = [...state.samples.filter((s) => time - s.time <= HISTORY_MS), { time, cents }];
  let { success, releaseSince, rearmed, attemptSince } = state;
  if (success && !feedbackPlaying) {
    const released = cents === null || Math.abs(cents) > accuracyCents + 1e-6;
    releaseSince = released ? (releaseSince ?? time) : null;
    if (releaseSince !== null && time - releaseSince >= MAX_GAP_MS) rearmed = true;
    // Preserve the last result through silence, then start fresh on the next note.
    // Speaker feedback is still recorded, but cannot re-arm the success cue.
    if (rearmed && cents !== null) {
      success = null;
      attemptSince = time;
      rearmed = false;
      releaseSince = null;
    }
  }
  const recent = samples.filter((s) => time - s.time <= WINDOW_MS && s.time >= attemptSince);
  let valid = recent.filter((s) => s.cents !== null);
  // A long silence / background-tab pause must not count as time on pitch.
  for (let i = valid.length - 1; i > 0; i--) {
    if (valid[i].time - valid[i - 1].time > MAX_GAP_MS) {
      valid = valid.slice(i);
      break;
    }
  }
  if (valid.length && time - valid.at(-1).time > MAX_GAP_MS) valid = [];
  const mean = valid.length ? valid.reduce((sum, s) => sum + s.cents, 0) / valid.length : 0;
  const deviation = valid.length
    ? Math.sqrt(valid.reduce((sum, s) => sum + (s.cents - mean) ** 2, 0) / valid.length)
    : 0;
  const ratio = valid.length
    ? valid.filter((s) => Math.abs(s.cents) <= accuracyCents + 1e-6).length / valid.length
    : 0;
  const span = valid.length > 1 ? valid.at(-1).time - valid[0].time : 0;
  const frames = valid.length ? recent.filter((s) => s.time >= valid[0].time).length : 0;
  const coverage = frames ? valid.length / frames : 0;
  const steady =
    cents !== null &&
    Math.abs(mean) <= accuracyCents + 1e-6 &&
    deviation <= accuracyCents &&
    ratio >= 0.8 &&
    coverage >= 0.85;
  const progress = steady ? Math.min(1, span / HOLD_MS) : 0;
  const stats = valid.length ? { mean, deviation, ratio, span, count: valid.length } : null;
  success =
    success ||
    (!feedbackPlaying && progress >= 1 && valid.length >= 5 ? { time, mean, deviation } : null);
  return {
    key,
    accuracyCents,
    samples,
    now: time,
    progress,
    stats,
    success,
    releaseSince,
    rearmed,
    attemptSince,
  };
}
