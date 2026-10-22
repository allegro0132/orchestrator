import { centsOff, frequency } from './pitch.js';
export const SCORE_ACCURACY_CENTS = 20;
export function createPracticeFeedback(events, from = 0) {
  return {
    from,
    next: 0,
    outcomes: events.map(() => null),
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    serial: 0,
    last: null,
    candidate: null,
    lastTime: null,
  };
}
function judge(state, index, type, time, cents = null) {
  if (state.outcomes[index]) return;
  if (type === 'miss') {
    state.misses++;
    state.combo = 0;
  } else {
    state.hits++;
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
  }
  const result = { id: ++state.serial, index, type, time, cents, combo: state.combo };
  state.outcomes[index] = result;
  state.last = result;
}
export function pausePracticeFeedback(state) {
  state.candidate = null;
  state.lastTime = null;
}
// This is pitch feedback, not a bow-attack or rhythm grade. Rest notes do not break a combo.
export function advancePracticeFeedback(state, events, time, hz, reference = 440) {
  while (state.next < events.length && events[state.next].end <= time) {
    const event = events[state.next];
    if (event.midi !== null && event.end > state.from) judge(state, state.next, 'miss', event.end);
    state.next++;
  }
  const index = state.next,
    event = events[index];
  const cents =
    event?.midi != null && Number.isFinite(hz) && hz > 0
      ? centsOff(hz, frequency(event.midi, reference))
      : null;
  if (
    event &&
    time >= Math.max(event.start, state.from) &&
    !state.outcomes[index] &&
    cents !== null &&
    Math.abs(cents) <= SCORE_ACCURACY_CENTS + 1e-6
  ) {
    if (
      state.candidate?.index !== index ||
      state.lastTime === null ||
      time - state.lastTime > 0.075
    )
      state.candidate = { index, since: time, sum: 0, count: 0 };
    const candidate = state.candidate;
    candidate.sum += cents;
    candidate.count++;
    const hold = Math.min(0.08, (event.end - Math.max(event.start, state.from)) * 0.35);
    if (candidate.count >= 2 && time - candidate.since + 1e-6 >= hold) {
      const average = candidate.sum / candidate.count;
      judge(state, index, Math.abs(average) <= 10 + 1e-6 ? 'perfect' : 'good', time, average);
      state.candidate = null;
    }
  } else state.candidate = null;
  state.lastTime = time;
  return state;
}
const RECORDS_KEY = 'arco-practice-combos-v1';
// The same part/voice at different tempos shares a personal best. No audio is stored.
export function practiceRecordKey(track) {
  if (!track) return null;
  const value = JSON.stringify([
    track.id,
    track.name,
    track.events.map((e) => [e.midi, e.beat, e.duration]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function readPracticeRecord(key, storage) {
  try {
    const record = JSON.parse((storage ?? globalThis.localStorage).getItem(RECORDS_KEY))?.[key];
    if (Number.isInteger(record?.best) && record.best >= 0) return record;
  } catch {}
  return { best: 0, last: null };
}
export function savePracticeRecord(key, feedback, storage) {
  if (!key || !feedback.serial) return readPracticeRecord(key, storage);
  const old = readPracticeRecord(key, storage);
  const record = {
    best: Math.max(old.best, feedback.maxCombo),
    updatedAt: Date.now(),
    last: {
      combo: feedback.combo,
      maxCombo: feedback.maxCombo,
      hits: feedback.hits,
      misses: feedback.misses,
    },
  };
  try {
    const local = storage ?? globalThis.localStorage;
    let records;
    try {
      records = JSON.parse(local.getItem(RECORDS_KEY));
    } catch {}
    if (!records || typeof records !== 'object' || Array.isArray(records)) records = {};
    records[key] = record;
    const entries = Object.entries(records)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(0, 50);
    local.setItem(RECORDS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
  return record;
}
