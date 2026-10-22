// Rebuild the bundled practice editions from the credited Mutopia sources.
// Run from violin-tuner: node scripts/build-score-library.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import * as MidiLibrary from '@tonejs/midi';
import { SCORE_LIBRARY } from '../src/scoreLibrary.js';
import { escapeXml as esc } from '../src/score.js';
const Midi = MidiLibrary.Midi || MidiLibrary.default.Midi;
const sources = new URL('./score-sources/', import.meta.url);
const output = new URL('../public/scores/', import.meta.url);
const n = (pitch, duration = 1) => ({ pitch, duration });
const line = (pitches) => pitches.split(' ').map((p) => n(p));
// Dowland's tenor carries the hymn melody; halve note values and raise one octave.
const old100 = [
  [n('G4', 2)],
  line('G4 F#4 E4 D4'),
  [n('G4', 2), n('A4', 2)],
  [n('B4', 2), n('B4', 2)],
  line('B4 B4 A4 G4'),
  [n('C5', 2), n('B4', 2)],
  [n('A4', 2), n('G4', 2)],
  line('A4 B4 A4 G4'),
  [n('E4', 2), n('F#4', 2)],
  [n('G4', 2), n('D5', 2)],
  line('B4 G4 A4 C5'),
  [n('B4', 2), n('A4', 2)],
  [n('G4', 2)],
];
// Mori's vocal line in D rather than E-flat, with ornaments omitted.
const lullaby = [
  [n('F#4', 0.5), n('F#4', 0.5)],
  [n('A4', 1.5), n('F#4', 0.5), n('F#4')],
  [n('A4'), n(null), n('F#4', 0.5), n('A4', 0.5)],
  [n('D5'), n('C#5', 1.5), n('B4', 0.5)],
  [n('B4'), n('A4'), n('E4', 0.5), n('F#4', 0.5)],
  [n('G4'), n('E4'), n('E4', 0.5), n('F#4', 0.5)],
  [n('G4'), n(null), n('E4', 0.5), n('G4', 0.5)],
  [n('C#5', 0.5), n('B4', 0.5), n('A4'), n('C#5')],
  [n('D5'), n(null), n('D4', 0.5), n('D4', 0.5)],
  [n('D5', 2), n('B4', 0.5), n('G4', 0.5)],
  [n('A4', 2), n('F#4', 0.5), n('D4', 0.5)],
  line('G4 A4 B4'),
  [n('A4', 2), n('D4', 0.5), n('D4', 0.5)],
  [n('D5', 2), n('B4', 0.5), n('G4', 0.5)],
  [n('A4', 2), n('F#4', 0.5), n('D4', 0.5)],
  line('G4 F#4 E4'),
  [n('D4', 2), n(null)],
];
// Chubb's soprano line, transposed down a fourth into D major.
const ode = [
  line('F#4 F#4 G4 A4'),
  line('A4 G4 F#4 E4'),
  line('D4 D4 E4 F#4'),
  [n('F#4', 1.5), n('E4', 0.5), n('E4', 2)],
  line('F#4 F#4 G4 A4'),
  line('A4 G4 F#4 E4'),
  line('D4 D4 E4 F#4'),
  [n('E4', 1.5), n('D4', 0.5), n('D4', 2)],
  line('E4 E4 F#4 D4'),
  [n('E4'), n('F#4', 0.5), n('G4', 0.5), n('F#4'), n('D4')],
  [n('E4'), n('F#4', 0.5), n('G4', 0.5), n('F#4'), n('E4')],
  [n('D4'), n('E4'), n('A3', 2)],
  line('F#4 F#4 G4 A4'),
  line('A4 G4 F#4 E4'),
  line('D4 D4 E4 F#4'),
  [n('E4', 1.5), n('D4', 0.5), n('D4', 2)],
];
// Garvin's first section, omitting grace notes and mordents.
const minuet = [
  [n('D5'), ...['G4', 'A4', 'B4', 'C5'].map((p) => n(p, 0.5))],
  line('D5 G4 G4'),
  [n('E5'), ...['C5', 'D5', 'E5', 'F#5'].map((p) => n(p, 0.5))],
  line('G5 G4 G4'),
  [n('C5'), ...['D5', 'C5', 'B4', 'A4'].map((p) => n(p, 0.5))],
  [n('B4'), ...['C5', 'B4', 'A4', 'G4'].map((p) => n(p, 0.5))],
  [n('F#4'), ...['G4', 'A4', 'B4', 'G4'].map((p) => n(p, 0.5))],
  [n('A4', 3)],
];
minuet.push(
  ...minuet.slice(0, 6),
  [n('A4'), ...['B4', 'A4', 'G4', 'F#4'].map((p) => n(p, 0.5))],
  [n('G4', 3)],
);
// Breizh Partitions' 9/8 melody, without bagpipe ornaments; written pitches -8 semitones.
const amazing = [
  [n('D4'), n('G4', 0.5)],
  [n('G4', 3), n('B4', 0.75), n('A4', 0.25), n('G4', 0.5)],
  [n('B4', 3), n('B4'), n('A4', 0.5)],
  [n('G4', 3), n('E4', 1.5)],
  [n('D4', 3), n('D4'), n('G4', 0.5)],
  [n('G4', 3), n('B4', 0.75), n('A4', 0.25), n('G4', 0.5)],
  [n('B4', 3), n('A4'), n('B4', 0.5)],
  [n('D5', 3), n('D5', 1.5)],
  [n('D5', 3), n('B4'), n('D5', 0.5)],
  [n('D5', 3), n('B4', 0.75), n('A4', 0.25), n('G4', 0.5)],
  [n('B4', 3), n('B4'), n('A4', 0.5)],
  [n('G4', 3), n('E4', 1.5)],
  [n('D4', 3), n('D4'), n('G4', 0.5)],
  [n('G4', 3), n('B4', 0.75), n('A4', 0.25), n('G4', 0.5)],
  [n('B4', 3), n('A4', 1.5)],
  [n('G4', 3), n('G4', 1.5)],
  [n('G4', 3)],
];
function midiBars(id, start, lengths) {
  const midi = new Midi(readFileSync(new URL(`${id}.mid`, sources)));
  let at = start;
  return lengths.map((length) => {
    const end = at + length;
    const notes = [];
    let cursor = at;
    for (const note of midi.tracks[0].notes.filter(
      (note) => note.ticks / midi.header.ppq >= at && note.ticks / midi.header.ppq < end,
    )) {
      const onset = note.ticks / midi.header.ppq,
        duration = note.durationTicks / midi.header.ppq;
      if (onset < cursor || onset + duration > end + 1e-6)
        throw new Error(`${id}: overlap or bar-crossing note`);
      if (onset > cursor) notes.push(n(null, onset - cursor));
      notes.push(n(note.name, duration));
      cursor = onset + duration;
    }
    if (cursor < end) notes.push(n(null, end - cursor));
    at = end;
    return notes;
  });
}
const editions = {
  old100: { bars: old100, meter: [4, 4], fifths: 1, pickup: true },
  lullaby: { bars: lullaby, meter: [3, 4], fifths: 2, pickup: true },
  gavotte: {
    bars: midiBars('gavotte', 0, [2, ...Array(8).fill(4)]),
    meter: [2, 2],
    fifths: 1,
    pickup: true,
  },
  ode: { bars: ode, meter: [4, 4], fifths: 2 },
  amazing: { bars: amazing, meter: [9, 8], fifths: 1, pickup: true },
  minuet: { bars: minuet, meter: [3, 4], fifths: 1 },
  greensleeves: { bars: midiBars('greensleeves', 0, Array(8).fill(6)), meter: [3, 2], fifths: -2 },
  rag: {
    bars: midiBars('rag', 0, [1, ...Array(8).fill(4)]),
    meter: [4, 4],
    fifths: 1,
    pickup: true,
  },
  rieding: { bars: midiBars('rieding', 16, Array(16).fill(4)), meter: [4, 4], fifths: 2 },
};
editions.greensleeves.bars[7][0].tie = 'start';
editions.greensleeves.bars[7][1].tie = 'stop';
const values = [
  [6, 'whole', true],
  [4, 'whole', false],
  [3, 'half', true],
  [2, 'half', false],
  [1.5, 'quarter', true],
  [1, 'quarter', false],
  [0.75, 'eighth', true],
  [0.5, 'eighth', false],
  [0.25, '16th', false],
];
function noteXml(note, fifths) {
  let [length, type, dot] = values.find(([v]) => Math.abs(v - note.duration) < 1e-6) || [];
  if (!length) throw new Error(`Unsupported note: ${JSON.stringify(note)}`);
  if (!note.pitch)
    return `<note><rest/><duration>${length * 4}</duration><type>${type}</type>${dot ? '<dot/>' : ''}</note>`;
  let [_, step, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(note.pitch);
  // MIDI spells B-flat as A-sharp; use the source's G-minor spelling.
  if (fifths < 0 && step === 'A' && accidental === '#') {
    step = 'B';
    accidental = 'b';
  }
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${length * 4}</duration>${note.tie ? `<tie type="${note.tie}"/>` : ''}<type>${type}</type>${dot ? '<dot/>' : ''}${note.tie ? `<notations><tied type="${note.tie}"/></notations>` : ''}</note>`;
}
for (const item of SCORE_LIBRARY) {
  const { bars, meter, fifths, pickup } = editions[item.id];
  if (bars.length !== item.bars) throw new Error(`${item.id}: wrong bar count`);
  const rights = `${item.license}; ${item.credit}; ${item.licenseUrl}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>${esc(item.title.en)}</work-title></work><identification><creator type="composer">${esc(item.composer)}</creator><creator type="arranger">ARCO practice edition</creator><rights>${esc(rights)}</rights><source>${esc(item.sourceUrl)}</source><miscellaneous><miscellaneous-field name="modifications">${esc(item.edition.en)}</miscellaneous-field></miscellaneous></identification><part-list><score-part id="P1"><part-name>Violin melody</part-name></score-part></part-list><part id="P1">${bars.map((notes, i) => `<measure number="${i + 1}"${pickup && (i === 0 || notes.reduce((s, n) => s + n.duration, 0) < (meter[0] * 4) / meter[1]) ? ' implicit="yes"' : ''}>${i === 0 ? `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths><mode>${['greensleeves', 'rieding'].includes(item.id) ? 'minor' : 'major'}</mode></key><time><beats>${meter[0]}</beats><beat-type>${meter[1]}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${item.bpm}</per-minute></metronome></direction-type><sound tempo="${item.bpm}"/></direction>` : ''}${notes.map((note) => noteXml(note, fifths)).join('')}${i === bars.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}</measure>`).join('\n')}</part></score-partwise>\n`;
  writeFileSync(new URL(`${item.id}.musicxml`, output), xml);
}
