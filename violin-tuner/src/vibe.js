import { escapeXml, parseMusicXml } from './score.js';

export const VIBE_MAX_SECONDS = 600;
export const VIBE_KEYS = [
  { id: 'D', tonic: 2, minor: false, fifths: 2 },
  { id: 'G', tonic: 7, minor: false, fifths: 1 },
  { id: 'A', tonic: 9, minor: false, fifths: 3 },
  { id: 'C', tonic: 0, minor: false, fifths: 0 },
  { id: 'Em', tonic: 4, minor: true, fifths: 1 },
  { id: 'Am', tonic: 9, minor: true, fifths: 0 },
  { id: 'Bm', tonic: 11, minor: true, fifths: 2 },
  { id: 'Dm', tonic: 2, minor: true, fifths: -1 },
];
export const keyName = (key) => `${key.id.replace('m', '')} ${key.minor ? 'minor' : 'major'}`;
const intervals = (key) => (key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]);
const inScale = (midi, key) => intervals(key).includes((((midi - key.tonic) % 12) + 12) % 12);
export function estimateVibeKey(notes) {
  if (!notes.length) return VIBE_KEYS[0];
  return VIBE_KEYS.map((key) => ({
    key,
    score: notes
      .slice(-24)
      .reduce(
        (score, n) =>
          score +
          (inScale(n.midi, key) ? 1 : -3) * Math.min(2, n.duration) +
          (n.midi % 12 === key.tonic ? 0.15 : 0),
        0,
      ),
  })).sort((a, b) => b.score - a.score)[0].key;
}
export function createCapture(notes = []) {
  return { notes: [...notes], active: null, candidate: null, lastVoiced: -Infinity };
}
function finish(capture, end) {
  const active = capture.active;
  if (active && end - active.start >= 0.1)
    capture.notes.push({
      midi: active.midi,
      start: active.start,
      duration: end - active.start,
      hz: active.sum / active.samples,
    });
  capture.active = null;
}
export function capturePitch(capture, time, hz, reference = 440) {
  if (!Number.isFinite(time) || time < 0) return;
  const pitch = hz > 0 ? 69 + 12 * Math.log2(hz / reference) : NaN;
  if (!Number.isFinite(pitch) || pitch < 54.5 || pitch > 98.5) {
    capture.candidate = null;
    if (capture.active && time - capture.lastVoiced > 0.18)
      finish(capture, capture.lastVoiced + 0.04);
    return;
  }
  if (capture.active && time - capture.lastVoiced > 0.18)
    finish(capture, capture.lastVoiced + 0.04);
  capture.lastVoiced = time;
  const midi = Math.max(55, Math.min(98, Math.round(pitch)));
  if (capture.active && Math.abs(pitch - capture.active.midi) < 0.68) {
    capture.active.sum += hz;
    capture.active.samples++;
    capture.candidate = null;
    return;
  }
  if (capture.candidate?.midi !== midi)
    capture.candidate = { midi, start: time, samples: 0, sum: 0 };
  const candidate = capture.candidate;
  candidate.samples++;
  candidate.sum += hz;
  if (candidate.samples >= 3 && time - candidate.start >= 0.08) {
    finish(capture, candidate.start);
    capture.active = { ...candidate };
    capture.candidate = null;
  }
}
export function captureNotes(capture, time, final = false) {
  if (final) {
    finish(capture, Math.min(time, capture.lastVoiced + 0.04));
    capture.candidate = null;
  }
  const notes = [...capture.notes];
  const n = capture.active;
  if (n && time - n.start >= 0.1)
    notes.push({
      midi: n.midi,
      start: n.start,
      duration: Math.max(0.1, Math.min(time, capture.lastVoiced + 0.04) - n.start),
      hz: n.sum / n.samples,
    });
  return notes;
}
function nearest(value, choices) {
  return choices.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
}
export function generateVibeBars(notes, fromBar, count, bpm, key, seed = 1) {
  if (!notes.length) return [];
  const scale = Array.from({ length: 29 }, (_, i) => 55 + i).filter((m) => inScale(m, key));
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
export function extendVibe(session, notes, beat) {
  const bar = Math.floor(beat / 4);
  if (
    session.lastGeneratedBar === bar ||
    !notes.length ||
    (notes.length < 2 && (notes[0].duration * session.bpm) / 60 < 2)
  )
    return false;
  session.lastGeneratedBar = bar;
  const key =
    session.key === 'auto'
      ? estimateVibeKey(notes)
      : VIBE_KEYS.find((k) => k.id === session.key) || VIBE_KEYS[0];
  // Keep the current bar and next bar immutable. Revise only the more distant horizon.
  const from = session.bars.length ? bar + 2 : bar + 1;
  const bars = generateVibeBars(
    notes,
    from,
    4 - (from - (bar + 1)),
    session.bpm,
    key,
    session.seed,
  );
  session.bars = [...session.bars.filter((b) => b.bar < from), ...bars];
  session.revisions.push({ atBeat: beat, fromBar: from, key: key.id, bars });
  session.estimatedKey = key.id;
  return true;
}
export function quantizePerformance(notes, bpm) {
  let end = 0;
  return notes.map((note) => {
    const beat = Math.max(end, Math.round(((note.start * bpm) / 60) * 2) / 2);
    const duration = Math.max(0.5, Math.round(((note.duration * bpm) / 60) * 2) / 2);
    end = beat + duration;
    return { midi: note.midi, beat, duration };
  });
}
const lengths = [
  [4, 'whole'],
  [3, 'half'],
  [2, 'half'],
  [1.5, 'quarter'],
  [1, 'quarter'],
  [0.5, 'eighth'],
];
function xmlNote(midi, duration, tieStart = false, tieStop = false, fifths = 0) {
  const flat = midi !== null && fifths < 0 && midi % 12 === 10;
  const pitch =
    midi === null
      ? '<rest/>'
      : `<pitch><step>${flat ? 'B' : ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][midi % 12]}</step>${flat ? '<alter>-1</alter>' : [1, 3, 6, 8, 10].includes(midi % 12) ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
  return `<note>${pitch}<duration>${duration * 2}</duration>${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}<type>${lengths.find(([n]) => n === duration)[1]}</type>${[1.5, 3].includes(duration) ? '<dot/>' : ''}${tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>` : ''}</note>`;
}
export function vibeXml(events, bpm, title = 'Vibe', keyId = 'D', endBeat = 0, numberOffset = 0) {
  const key = VIBE_KEYS.find((k) => k.id === keyId) || VIBE_KEYS[0];
  const end = Math.max(4, endBeat, ...events.map((e) => e.beat + e.duration));
  let body = '';
  for (let bar = 0; bar < Math.ceil(end / 4); bar++) {
    let position = bar * 4,
      notes = '';
    function append(midi, duration, start, ending, original) {
      let cursor = start;
      while (duration > 0) {
        const length = lengths.find(([n]) => n <= duration + 0.00001)[0];
        const stop = cursor + length;
        notes += xmlNote(
          midi,
          length,
          midi !== null && stop < original.beat + original.duration - 0.00001,
          midi !== null && cursor > original.beat + 0.00001,
          key.fifths,
        );
        cursor = stop;
        duration -= length;
      }
    }
    for (const event of events.filter(
      (e) => e.beat < (bar + 1) * 4 && e.beat + e.duration > bar * 4,
    )) {
      const start = Math.max(bar * 4, event.beat),
        stop = Math.min((bar + 1) * 4, event.beat + event.duration);
      if (start > position)
        append(null, start - position, position, start, {
          beat: position,
          duration: start - position,
        });
      append(event.midi, stop - start, start, stop, event);
      position = stop;
    }
    if (position < (bar + 1) * 4)
      append(null, (bar + 1) * 4 - position, position, (bar + 1) * 4, {
        beat: position,
        duration: (bar + 1) * 4 - position,
      });
    body += `<measure number="${bar + 1 + numberOffset}">${bar === 0 ? `<attributes><divisions>2</divisions><key><fifths>${key.fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><words/></direction-type><sound tempo="${bpm}"/></direction>` : ''}${notes}</measure>`;
  }
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work><part-list><score-part id="P1"><part-name>${escapeXml(title)}</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
export const vibeTrack = (events, bpm, title, key, end, numberOffset = 0) =>
  parseMusicXml(vibeXml(events, bpm, title, key, end, numberOffset)).tracks[0];
export function newVibeSession(bpm = 60, key = 'auto') {
  return {
    version: 1,
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    bpm,
    key,
    seed: Math.floor(Math.random() * 10000),
    elapsed: 0,
    notes: [],
    bars: [],
    revisions: [],
    lastGeneratedBar: -1,
  };
}
