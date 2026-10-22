import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import { SCORE_LIBRARY } from './scoreLibrary.js';
import { importScore, secondsAt } from './score.js';

async function read(id) {
  return importScore(
    new File(
      [readFileSync(new URL(`../public/scores/${id}.musicxml`, import.meta.url))],
      `${id}.musicxml`,
    ),
  );
}
test('all bundled editions import as playable violin melodies with attribution and useful durations', async () => {
  for (const item of SCORE_LIBRARY) {
    const score = await read(item.id);
    assert.equal(score.tracks.length, 1);
    const track = score.tracks[0];
    assert.equal(track.measures.length, item.bars, item.id);
    const notes = track.events.filter((event) => event.midi !== null);
    assert.ok(notes.length >= 20);
    for (const note of notes) {
      assert.ok(note.midi >= 55 && note.midi <= 83, `${item.id}: violin range`);
      assert.ok(note.duration > 0);
    }
    for (let i = 1; i < track.events.length; i++)
      assert.ok(
        track.events[i].beat >= track.events[i - 1].beat + track.events[i - 1].duration - 1e-6,
        `${item.id}: overlapping notes`,
      );
    assert.ok(secondsAt(track, track.duration) >= 20);
    assert.equal(track.tempos.at(-1).bpm, item.bpm);
    const xml = readFileSync(
      new URL(`../public/scores/${item.id}.musicxml`, import.meta.url),
      'utf8',
    );
    assert.ok(xml.includes(item.licenseUrl));
    assert.ok(xml.includes(item.sourceUrl));
    assert.ok(item.edition.en && item.edition.zh && item.title.en && item.title.zh);
  }
});
test('pickup bars, source excerpt rests, and final sustained tie keep their timing', async () => {
  const amazing = (await read('amazing')).tracks[0];
  assert.equal(amazing.measures[1].beat, 1.5);
  assert.equal(amazing.measures.at(-1).duration, 3);
  const rag = (await read('rag')).tracks[0];
  assert.equal(rag.measures[1].beat, 1);
  assert.equal(rag.duration, 33);
  const rieding = (await read('rieding')).tracks[0];
  assert.equal(rieding.events[0].midi, 78);
  assert.equal(rieding.duration, 64);
  assert.equal(rieding.events.at(-1).midi, null);
  const green = (await read('greensleeves')).tracks[0];
  assert.equal(green.events.at(-1).duration, 6);
  assert.equal(green.duration, 48);
});
test('opening melodies match the credited source lines', async () => {
  assert.deepEqual(
    (await read('ode')).tracks[0].events.slice(0, 8).map((e) => e.midi),
    [66, 66, 67, 69, 69, 67, 66, 64],
  );
  assert.deepEqual(
    (await read('minuet')).tracks[0].events.slice(0, 5).map((e) => e.midi),
    [74, 67, 69, 71, 72],
  );
});
test('new hymn, lullaby and gavotte retain their chosen melodies and pickup lengths', async () => {
  const hymn = (await read('old100')).tracks[0];
  assert.equal(hymn.measures[1].beat, 2);
  assert.deepEqual(
    hymn.events.slice(0, 5).map((e) => e.midi),
    [67, 67, 66, 64, 62],
  );
  assert.equal(hymn.duration, 48);
  const lullaby = (await read('lullaby')).tracks[0];
  assert.equal(lullaby.measures[1].beat, 1);
  assert.deepEqual(
    lullaby.events.slice(0, 4).map((e) => e.midi),
    [66, 66, 69, 66],
  );
  assert.equal(lullaby.duration, 49);
  assert.equal(lullaby.events.at(-1).midi, null);
  const gavotte = (await read('gavotte')).tracks[0];
  assert.equal(gavotte.measures[1].beat, 2);
  assert.deepEqual(
    gavotte.events.slice(0, 4).map((e) => e.midi),
    [71, 72, 74, 79],
  );
  assert.equal(gavotte.duration, 34);
});
