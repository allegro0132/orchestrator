import { test } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { zipSync, strToU8 } from 'fflate';
import * as MidiLibrary from '@tonejs/midi';
import {
  parseMusicXml,
  DEMO_XML,
  importScore,
  secondsAt,
  timedEvents,
  excerptXml,
} from './score.js';
const Midi = MidiLibrary.Midi || MidiLibrary.default.Midi;
const wrap = (body) =>
  `<score-partwise><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
const note = (step = 'A', extra = '', duration = 2) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;
test('imports demo and preserves note pitch, beat length, and measure positions', () => {
  const score = parseMusicXml(DEMO_XML),
    tr = score.tracks[0];
  assert.equal(tr.events.length, 16);
  assert.equal(tr.events[2].midi, 73);
  assert.equal(tr.measures[2].beat, 8);
  assert.equal(secondsAt(tr, 16), 12);
  assert.equal(timedEvents(tr, 60)[4].start, 4);
});
test('handles divisions, tempo changes, dotted tempo units, rests, and tied notes', () => {
  const tr = parseMusicXml(
    wrap(
      `<measure number="1"><attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="60"/></direction>${note('A', '<tie type="start"/>', 4)}</measure><measure number="2"><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>${note('A', '<tie type="stop"/>', 2)}<note><rest/><duration>2</duration></note></measure>`,
    ),
  ).tracks[0];
  assert.equal(tr.events[0].duration, 3);
  assert.equal(tr.events[1].midi, null);
  assert.equal(tr.events[1].beat, 3);
  assert.equal(secondsAt(tr, 4), 3);
  assert.equal(timedEvents(tr)[0].end, 2.5);
});
test('separates voices, chooses highest chord note, and keeps written repeats explicit', () => {
  const tr = parseMusicXml(
    wrap(
      `<measure number="1"><attributes><divisions>2</divisions></attributes>${note('A', '<voice>1</voice>')}${note('B', '<chord/><voice>1</voice>')}<backup><duration>2</duration></backup>${note('D', '<voice>2</voice>')}<barline><repeat direction="backward"/></barline></measure>`,
    ),
  ).tracks;
  assert.equal(tr.length, 2);
  assert.equal(tr[0].events[0].midi, 71);
  assert.equal(tr[1].events[0].midi, 62);
  assert.ok(tr[0].complex);
});
test('excerpt preserves inherited key, divisions, and clef for neighboring measures', () => {
  const tr = parseMusicXml(DEMO_XML).tracks[0],
    xml = excerptXml(tr, 3);
  assert.ok(xml.startsWith('<?xml'));
  assert.match(xml, /<fifths>2/);
  assert.match(xml, /<clef>/);
  const excerpt = parseMusicXml(xml);
  assert.equal(excerpt.tracks[0].measures.length, 2);
  assert.equal(excerpt.tracks[0].measures[0].bar, '3');
});
test('MXL follows the container rootfile and MIDI retains tempo and note onsets', async () => {
  const mxl = zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>',
    ),
    'scores/main.musicxml': strToU8(DEMO_XML),
  });
  const score = await importScore(new File([mxl], 'example.mxl'));
  assert.equal(score.tracks[0].events.length, 16);
  const midi = new Midi();
  midi.header.setTempo(120);
  midi
    .addTrack()
    .addNote({ midi: 69, ticks: 0, durationTicks: 480 })
    .addNote({ midi: 71, ticks: 960, durationTicks: 480 });
  const imported = await importScore(new File([midi.toArray()], 'example.mid'));
  const events = timedEvents(imported.tracks[0]);
  assert.equal(events[0].midi, 69);
  assert.equal(events.find((e) => e.midi === 71).start, 1);
  assert.ok(imported.midi);
});
test('rejects unsupported, oversized, malformed, empty, and entity-bearing scores', async () => {
  await assert.rejects(importScore(new File(['pdf'], 'score.pdf')));
  await assert.rejects(importScore({ size: 11 * 1024 * 1024, name: 'score.xml' }), /size/);
  assert.throws(() => parseMusicXml('<score-partwise><part>'));
  assert.throws(() => parseMusicXml(wrap('<measure/>')), /empty/);
  assert.throws(
    () => parseMusicXml('<!DOCTYPE score-partwise [<!ENTITY x "test">]>' + DEMO_XML),
    /unsafe/,
  );
});
test('shares conductor tempo directions with parts that have no local tempo marks', () => {
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Conductor</part-name></score-part><score-part id="P2"><part-name>Violin</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>2</divisions></attributes><sound tempo="120"/>${note()}</measure></part><part id="P2"><measure><attributes><divisions>2</divisions></attributes>${note()}</measure></part></score-partwise>`;
  const score = parseMusicXml(xml);
  assert.equal(secondsAt(score.tracks[1], 1), 0.5);
});
