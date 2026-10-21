import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEGINNER_LESSONS, lessonScore } from './beginnerLessons.js';
import { timedEvents, secondsAt } from './score.js';
const get = (id) => BEGINNER_LESSONS.find((l) => l.id === id);
test('all seven lessons produce playable notation with matching action cues and timing', () => {
  assert.equal(BEGINNER_LESSONS.length, 7);
  for (const lesson of BEGINNER_LESSONS) {
    const track = lessonScore(lesson).tracks[0],
      events = timedEvents(track);
    assert.equal(events.length, lesson.cues.length, lesson.id);
    events.forEach((e, i) => {
      assert.equal(e.midi, lesson.cues[i].midi);
      assert.equal(e.duration, lesson.cues[i].beats);
      assert.ok(e.end > e.start);
      if (i) assert.ok(Math.abs(events[i - 1].end - e.start) < 0.00001);
    });
    assert.equal(
      secondsAt(track, track.duration),
      (lesson.cues.reduce((n, c) => n + c.beats, 0) * 60) / lesson.bpm,
    );
    assert.ok(track.measures.every((m) => m.duration === 4));
  }
});
test('D long bows contain exactly eight pairs with four beats per bow', () => {
  const lesson = get('long-bows');
  assert.equal(lesson.cues.length, 16);
  lesson.cues.forEach((c, i) => {
    assert.equal(c.midi, 62);
    assert.equal(c.beats, 4);
    assert.equal(c.bow, i % 2 ? 'up' : 'down');
    assert.equal(c.group, Math.floor(i / 2) + 1);
  });
  const xml = lessonScore(lesson)
    .tracks[0].measures.map((m) => m.xml)
    .join('');
  assert.match(xml, /<down-bow/);
  assert.match(xml, /<up-bow/);
});
test('four-string practice retains D A G E order with four pairs and an explicit placement rest', () => {
  const cues = get('open-strings').cues;
  const notes = cues.filter((c) => c.midi !== null);
  assert.deepEqual(
    [0, 8, 16, 24].map((i) => notes[i].midi),
    [62, 69, 55, 76],
  );
  assert.equal(notes.length, 32);
  assert.equal(cues.filter((c) => c.phase === 'place').length, 3);
  for (const c of cues.filter((c) => c.phase === 'place')) {
    assert.equal(c.beats, 4);
    assert.ok([69, 55, 76].includes(c.nextMidi));
  }
});
test('crossings explicitly alternate play, stop, and placement across all three pairs', () => {
  const cues = get('crossings').cues;
  assert.equal(cues.length, 144);
  for (let i = 0; i < cues.length; i += 3) {
    assert.equal(cues[i].beats, 1);
    assert.ok(cues[i].midi !== null);
    assert.equal(cues[i + 1].phase, 'stop');
    assert.equal(cues[i + 2].phase, i === cues.length - 3 ? 'finish' : 'place');
    if (i < cues.length - 3) assert.equal(cues[i + 2].nextMidi, cues[i + 3].midi);
  }
  assert.deepEqual(
    cues
      .filter((c) => c.midi !== null)
      .filter((c, i) => i % 16 === 0)
      .map((c) => c.midi),
    [62, 69, 62],
  );
  assert.deepEqual(
    cues
      .filter((c) => c.midi !== null)
      .slice(0, 4)
      .map((c) => c.midi),
    [62, 69, 62, 69],
  );
});
test('left-hand progressions use the exact requested D-string pitches and fingerings', () => {
  const patterns = [
    [62, 64, 62, 64, 62],
    [62, 64, 66, 64, 62],
    [62, 64, 66, 67, 66, 64, 62],
    [62, 64, 66, 67, 69, 67, 66, 64, 62],
  ];
  patterns.forEach((pattern, i) => {
    const l = get(`finger-${i + 1}`);
    assert.deepEqual(
      l.cues.slice(0, pattern.length).map((c) => c.midi),
      pattern,
    );
    assert.equal(l.cues.length, pattern.length * 4);
    for (const c of l.cues) {
      assert.equal(c.beats, 2);
      assert.equal(c.midi, [62, 64, 66, 67, 69][c.finger]);
    }
    assert.match(lessonScore(l).tracks[0].measures[0].xml, /<fingering>/);
  });
});
test('every exercise and checkpoint has English and Chinese copy', () => {
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if ('zh' in value) {
      assert.ok(value.zh);
      assert.ok(value.en);
      assert.doesNotMatch(value.en, /[\u4e00-\u9fff]/);
    } else Object.values(value).forEach(visit);
  }
  BEGINNER_LESSONS.forEach(visit);
});
