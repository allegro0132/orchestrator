import { centsOff, frequency } from './pitch.js';
import {
  createPracticeFeedback,
  advancePracticeFeedback,
  SCORE_ACCURACY_CENTS,
} from './practiceFeedback.js';
export function createScoreAnalysis(events, from = 0) {
  return {
    events,
    from,
    feedback: createPracticeFeedback(events, from),
    index: 0,
    results: events.map(() => ({
      samples: 0,
      accurate: 0,
      centsSum: 0,
      voicedSeconds: 0,
      onset: null,
    })),
    lastTime: null,
    lastHz: null,
    lastVoiced: -Infinity,
    candidate: null,
    trace: [],
  };
}
export function currentEvent(events, time) {
  return events.findIndex((e) => time >= e.start && time < e.end);
}
// Onsets require a stable pitch change or a voiced entry after an audible gap.
// A sustained repeated pitch is deliberately not treated as a new attack.
export function analyseScore(state, time, hz, reference = 440) {
  const { events } = state;
  const index = currentEvent(events, time),
    event = events[index];
  const dt = state.lastTime === null ? 0 : Math.min(0.075, Math.max(0, time - state.lastTime));
  const previousHz = state.lastHz;
  const gap = time - state.lastVoiced;
  if (hz && (gap > 0.12 || !previousHz || Math.abs(centsOff(hz, previousHz)) > 70))
    state.candidate = { time, hz, count: 1 };
  else if (hz && state.candidate && Math.abs(centsOff(hz, state.candidate.hz)) < 40)
    state.candidate.count++;
  else if (state.candidate && time - state.candidate.time > 0.15) state.candidate = null;
  if (state.candidate?.count === 2) {
    const onset = state.candidate;
    let best = -1,
      distance = Infinity;
    events.forEach((e, i) => {
      const delta = Math.abs(e.start - onset.time);
      if (
        e.midi !== null &&
        e.start >= state.from &&
        state.results[i].onset === null &&
        delta < Math.min(0.45, (e.end - Math.max(state.from, e.start)) * 0.6) &&
        delta < distance
      ) {
        best = i;
        distance = delta;
      }
    });
    if (best >= 0) state.results[best].onset = onset.time - events[best].start;
    state.candidate = null;
  }
  let cents = null;
  if (event && hz) {
    const result = state.results[index];
    result.voicedSeconds += Math.min(dt, Math.max(0, time - event.start));
    if (event.midi !== null) {
      cents = centsOff(hz, frequency(event.midi, reference));
      result.samples++;
      result.centsSum += cents;
      if (Math.abs(cents) <= SCORE_ACCURACY_CENTS + 1e-6) result.accurate++;
    }
  }
  state.trace.push({ time, cents });
  state.trace = state.trace.filter((s) => time - s.time <= 6);
  state.index = index;
  state.lastTime = time;
  if (hz) {
    state.lastVoiced = time;
    state.lastHz = hz;
  } else if (gap > 0.12) state.lastHz = null;
  advancePracticeFeedback(state.feedback, events, time, hz, reference);
  return state;
}
export function scoreSummary(state, until = Infinity) {
  const completed = state.events
    .map((e, i) => ({ ...e, ...state.results[i] }))
    .filter((e) => e.end <= until && e.end > state.from);
  const notes = completed.filter((e) => e.midi !== null),
    rests = completed.filter((e) => e.midi === null);
  const samples = notes.reduce((n, e) => n + e.samples, 0),
    accurate = notes.reduce((n, e) => n + e.accurate, 0);
  const onsets = notes.filter((e) => e.onset !== null);
  return {
    completed: notes.length,
    total: state.events.filter((e) => e.midi !== null && e.end > state.from).length,
    pitch: samples ? Math.round((100 * accurate) / samples) : null,
    coverage: notes.length
      ? Math.round(
          (100 *
            notes.reduce(
              (n, e) => n + Math.min(1, e.voicedSeconds / (e.end - Math.max(state.from, e.start))),
              0,
            )) /
            notes.length,
        )
      : 0,
    rhythm: onsets.length
      ? Math.round((100 * onsets.filter((e) => Math.abs(e.onset) <= 0.15).length) / onsets.length)
      : null,
    onsets: onsets.length,
    restNoise: rests.reduce((n, e) => n + e.voicedSeconds, 0),
  };
}
