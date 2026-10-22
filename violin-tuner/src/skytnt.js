// MIDITokenizerV2 contract at SkyTNT/midi-model f504d5cb58f769ab0f2909c679238f6621034573.
// Allocation follows the tokenizer constructor, NOT the alphabetically sorted config JSON.
export const SKY_MODEL = {
  repo: 'skytnt/midi-model-tv2o-medium',
  revision: '0f8f265d4330f4e46527ac2313200254c5757f5f',
  sourceRevision: 'f504d5cb58f769ab0f2909c679238f6621034573',
  license: 'Apache-2.0',
  files: {
    base: {
      bytes: 821713887,
      sha256: '1af68e16a0509936caeb70d322ab30619d784c7af72df019f3a59276c67c1bc4',
    },
    token: {
      bytes: 116661381,
      sha256: 'cce9376abe8f5c8d51d1b110580cc8501d38679af55ebd5a332e757e62ab9911',
    },
  },
};
const EVENTS = {
  note: ['time1', 'time2', 'track', 'channel', 'pitch', 'velocity', 'duration'],
  patch_change: ['time1', 'time2', 'track', 'channel', 'patch'],
  control_change: ['time1', 'time2', 'track', 'channel', 'controller', 'value'],
  set_tempo: ['time1', 'time2', 'track', 'bpm'],
  time_signature: ['time1', 'time2', 'track', 'nn', 'dd'],
  key_signature: ['time1', 'time2', 'track', 'sf', 'mi'],
};
const sizes = {
  time1: 128,
  time2: 16,
  duration: 2048,
  track: 128,
  channel: 16,
  pitch: 128,
  velocity: 128,
  patch: 128,
  controller: 128,
  value: 128,
  bpm: 384,
  nn: 16,
  dd: 4,
  sf: 15,
  mi: 2,
};
let offset = 9;
export const SKY_PARAMETERS = Object.fromEntries(
  Object.entries(sizes).map(([name, size]) => {
    const start = offset;
    offset += size;
    return [name, { start, size }];
  }),
);
const names = Object.keys(EVENTS);
export function skyEncode(name, values) {
  if (!EVENTS[name] || values.length !== EVENTS[name].length)
    throw new Error('Invalid SkyTNT event');
  const tokens = [
    3 + names.indexOf(name),
    ...EVENTS[name].map((parameter, i) => {
      const { start, size } = SKY_PARAMETERS[parameter],
        value = values[i];
      if (!Number.isInteger(value) || value < 0 || value >= size)
        throw new Error(`Invalid ${parameter}`);
      return start + value;
    }),
  ];
  return [...tokens, ...Array(8 - tokens.length).fill(0)];
}
export function skyDecode(tokens) {
  const name = names[tokens[0] - 3];
  if (!name || tokens.length !== 8) throw new Error('Invalid SkyTNT row');
  const values = EVENTS[name].map(
    (parameter, i) => tokens[i + 1] - SKY_PARAMETERS[parameter].start,
  );
  if (skyEncode(name, values).some((t, i) => t !== tokens[i]))
    throw new Error('Invalid SkyTNT row');
  return {
    name,
    ...Object.fromEntries(EVENTS[name].map((parameter, i) => [parameter, values[i]])),
  };
}
export function skyPrompt(
  notes,
  { bpm = 60, count = 4, fromBar, minMidi = 55, maxMidi = 83, maxGapBeats = 1, key = null } = {},
) {
  if (
    !notes.length ||
    !Number.isFinite(maxGapBeats) ||
    maxGapBeats < 0 ||
    maxGapBeats > 4 ||
    !Number.isInteger(maxGapBeats * 2) ||
    !Number.isFinite(bpm) ||
    bpm < 1 ||
    bpm > 383 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 4 ||
    !Number.isInteger(minMidi) ||
    !Number.isInteger(maxMidi) ||
    minMidi < 0 ||
    maxMidi > 127 ||
    minMidi > maxMidi ||
    (fromBar !== undefined && (!Number.isInteger(fromBar) || fromBar < 0))
  )
    throw new Error('Invalid SkyTNT request');
  for (const n of notes)
    if (
      !Number.isInteger(n.midi) ||
      n.midi < 0 ||
      n.midi > 127 ||
      !Number.isFinite(n.start) ||
      n.start < 0 ||
      !Number.isFinite(n.duration) ||
      n.duration <= 0
    )
      throw new Error('Invalid performed note');
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const lastEnd = Math.max(...sorted.map((n) => ((n.start + n.duration) * bpm) / 60));
  const windowStart = Math.max(0, lastEnd - 32);
  const recent = sorted.filter((n) => ((n.start + n.duration) * bpm) / 60 > windowStart).slice(-64);
  const origin = Math.max(windowStart, (recent[0].start * bpm) / 60);
  const rows = [[1, 0, 0, 0, 0, 0, 0, 0], skyEncode('time_signature', [0, 0, 0, 3, 1])];
  if (key) rows.push(skyEncode('key_signature', [0, 0, 0, key.fifths + 7, key.minor ? 1 : 0]));
  rows.push(
    skyEncode('set_tempo', [0, 0, 0, Math.round(bpm)]),
    skyEncode('patch_change', [0, 0, 1, 0, 40]),
  );
  let lastT1 = 0,
    end = 0;
  const context = [];
  for (const n of recent) {
    const begin = Math.max(origin, (n.start * bpm) / 60),
      stop = ((n.start + n.duration) * bpm) / 60;
    const start = Math.max(end, Math.round((begin - origin) * 2) * 8);
    const duration = Math.max(8, Math.round((stop - begin) * 2) * 8);
    const t1 = Math.floor(start / 16);
    rows.push(skyEncode('note', [t1 - lastT1, start % 16, 1, 0, n.midi, 80, duration]));
    lastT1 = t1;
    end = start + duration;
    context.push({ midi: n.midi, beat: start / 16, duration: duration / 16 });
  }
  const startTick = Math.ceil(end / 64) * 64;
  return {
    rows,
    context,
    startTick,
    endTick: startTick + count * 64,
    cursor: startTick,
    lastT1,
    count,
    fromBar: fromBar ?? startTick / 64,
    minMidi,
    maxMidi,
    maxGapTicks: maxGapBeats * 16,
    bpm,
    key,
  };
}
const timingChoices = (request, time1) =>
  [0, 8].filter((time2) => {
    const start = (request.lastT1 + time1) * 16 + time2;
    return (
      start >= request.cursor &&
      start <= request.cursor + request.maxGapTicks &&
      start < request.endTick
    );
  });
export function skyAllowed(request, prefix) {
  const position = prefix.length;
  if (position === 0) return [3]; // No EOS, accompaniment, patch changes or tempo changes within the horizon.
  const parameter = EVENTS.note[position - 1];
  let values;
  switch (parameter) {
    case 'time1':
      values = Array.from({ length: 128 }, (_, i) => i).filter(
        (i) => timingChoices(request, i).length,
      );
      break;
    case 'time2':
      values = timingChoices(request, prefix[1] - SKY_PARAMETERS.time1.start);
      break;
    case 'track':
      values = [1];
      break;
    case 'channel':
      values = [0];
      break;
    case 'pitch':
      values = Array.from(
        { length: request.maxMidi - request.minMidi + 1 },
        (_, i) => request.minMidi + i,
      );
      break;
    case 'velocity':
      values = [80];
      break;
    case 'duration': {
      const t1 = request.lastT1 + prefix[1] - SKY_PARAMETERS.time1.start;
      const start = t1 * 16 + prefix[2] - SKY_PARAMETERS.time2.start;
      const remaining = Math.min(request.endTick - start, 64 - (start % 64));
      values = [8, 16, 24, 32, 48, 64].filter((d) => d <= remaining);
      break;
    }
    default:
      throw new Error('Invalid note prefix');
  }
  if (!values.length) throw new Error('No legal SkyTNT continuation');
  return values.map((value) => SKY_PARAMETERS[parameter].start + value);
}
export function skyAccept(request, tokens) {
  // Validate every constraint independently of the inference implementation.
  for (let i = 0; i < 8; i++)
    if (!skyAllowed(request, tokens.slice(0, i)).includes(tokens[i]))
      throw new Error('Constraint violation');
  const event = skyDecode(tokens);
  request.lastT1 += event.time1;
  const start = request.lastT1 * 16 + event.time2;
  request.cursor = start + event.duration;
  return { midi: event.pitch, beat: start / 16, duration: event.duration / 16 };
}
export function skyBars(request, events) {
  const startBeat = request.startTick / 16,
    endBeat = request.endTick / 16;
  let cursor = startBeat;
  const filled = [];
  for (const event of events) {
    if (
      !Number.isInteger(event.midi) ||
      event.midi < request.minMidi ||
      event.midi > request.maxMidi ||
      event.beat < cursor ||
      !(event.duration > 0) ||
      !Number.isInteger(event.beat * 2) ||
      !Number.isInteger(event.duration * 2) ||
      event.beat + event.duration > endBeat
    )
      throw new Error('Invalid generated melody');
    if (event.beat > cursor)
      filled.push({ midi: null, beat: cursor, duration: event.beat - cursor });
    filled.push(event);
    cursor = event.beat + event.duration;
  }
  if (cursor < endBeat) filled.push({ midi: null, beat: cursor, duration: endBeat - cursor });
  return Array.from({ length: request.count }, (_, i) => {
    const low = startBeat + i * 4,
      high = low + 4,
      bar = request.fromBar + i;
    return {
      bar,
      key: request.key?.id,
      events: filled
        .filter((e) => e.beat < high && e.beat + e.duration > low)
        .map((e) => ({
          midi: e.midi,
          beat: bar * 4 + Math.max(low, e.beat) - low,
          duration: Math.min(high, e.beat + e.duration) - Math.max(low, e.beat),
        })),
    };
  });
}
