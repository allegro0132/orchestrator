import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import * as MidiLibrary from '@tonejs/midi';
const Midi = MidiLibrary.Midi || MidiLibrary['default']?.Midi;
const children = (node, name) =>
  Array.from(node?.childNodes || []).filter(
    (n) => n.nodeType === 1 && (!name || n.localName === name),
  );
const child = (node, name) => children(node, name)[0];
const value = (node, name, fallback = '') => child(node, name)?.textContent?.trim() || fallback;
const number = (node, name, fallback = 0) => Number(value(node, name, fallback));
const serialize = (node) => new XMLSerializer().serializeToString(node);
export const escapeXml = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );
export function parseXml(text) {
  if (/<!DOCTYPE[^>]*\[/i.test(text) || /<!ENTITY/i.test(text)) throw new Error('unsafe');
  const doc = new DOMParser({
    onError: (level) => {
      if (level !== 'warning') throw new Error('invalid');
    },
  }).parseFromString(text, 'text/xml');
  if (doc.documentElement?.localName !== 'score-partwise') throw new Error('format');
  return doc;
}
export function parseMusicXml(text) {
  const doc = parseXml(text),
    root = doc.documentElement;
  const title =
    value(child(root, 'work'), 'work-title') || value(root, 'movement-title') || 'Untitled';
  const names = new Map(
    children(child(root, 'part-list'), 'score-part').map((p) => [
      p.getAttribute('id'),
      value(p, 'part-name', 'Part'),
    ]),
  );
  const tracks = [];
  for (const part of children(root, 'part')) {
    let divisions = 1,
      offset = 0,
      meter = [4, 4];
    if (children(part, 'measure').length > 2000) throw new Error('size');
    const voices = new Map(),
      measures = [],
      tempos = [{ beat: 0, bpm: 80 }];
    let complex = false;
    for (const [mi, measure] of children(part, 'measure').entries()) {
      const attrs = child(measure, 'attributes');
      divisions = number(attrs, 'divisions', divisions);
      if (!(divisions > 0)) throw new Error('invalid');
      const time = child(attrs, 'time');
      if (time) meter = [number(time, 'beats', 4), number(time, 'beat-type', 4)];
      let cursor = 0,
        extent = 0,
        lastStart = 0;
      for (const element of children(measure)) {
        if (element.localName === 'sound' && Number(element.getAttribute('tempo')) > 0)
          tempos.push({ beat: offset + cursor, bpm: Number(element.getAttribute('tempo')) });
        if (element.localName === 'direction') {
          const sound = child(element, 'sound');
          const metronome = child(child(element, 'direction-type'), 'metronome');
          let bpm = Number(sound?.getAttribute('tempo'));
          if (!bpm && metronome) {
            const units = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
            bpm =
              number(metronome, 'per-minute') *
              (units[value(metronome, 'beat-unit')] || 1) *
              (child(metronome, 'beat-unit-dot') ? 1.5 : 1);
          }
          if (bpm > 0)
            tempos.push({ beat: offset + cursor + number(element, 'offset') / divisions, bpm });
        }
        if (element.localName === 'backup') cursor -= number(element, 'duration') / divisions;
        if (element.localName === 'forward') {
          cursor += number(element, 'duration') / divisions;
          extent = Math.max(extent, cursor);
        }
        if (element.localName !== 'note' || child(element, 'grace')) continue;
        const duration = number(element, 'duration') / divisions;
        if (!(duration > 0)) continue;
        const chord = !!child(element, 'chord'),
          start = chord ? lastStart : cursor;
        if (!chord) {
          lastStart = cursor;
          cursor += duration;
        }
        extent = Math.max(extent, start + duration);
        const pitch = child(element, 'pitch');
        const midi = pitch
          ? (number(pitch, 'octave') + 1) * 12 +
            ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[value(pitch, 'step')] ?? NaN) +
            number(pitch, 'alter')
          : null;
        if (midi !== null && (!Number.isFinite(midi) || midi < 0 || midi > 127))
          throw new Error('invalid');
        const voice = value(element, 'voice', '1');
        if (!voices.has(voice)) voices.set(voice, []);
        const events = voices.get(voice);
        const ties = children(element, 'tie').map((t) => t.getAttribute('type'));
        if (chord) {
          complex = true;
          const previous = events.findLast((e) => Math.abs(e.beat - (offset + start)) < 0.001);
          if (previous && midi !== null && (previous.midi === null || midi > previous.midi))
            previous.midi = midi;
        } else if (
          ties.includes('stop') &&
          events.at(-1)?.midi === midi &&
          Math.abs(events.at(-1).beat + events.at(-1).duration - offset - start) < 0.001
        ) {
          events.at(-1).duration += duration;
        } else
          events.push({
            beat: offset + start,
            duration,
            midi,
            measure: mi,
            bar: measure.getAttribute('number') || String(mi + 1),
          });
      }
      if (
        measure.getElementsByTagName('repeat').length ||
        measure.getElementsByTagName('ending').length
      )
        complex = true;
      const nominal = (meter[0] * 4) / meter[1];
      const length =
        measure.getAttribute('implicit') === 'yes' || mi === 0
          ? extent || nominal
          : Math.max(extent, nominal);
      measures.push({
        beat: offset,
        duration: length,
        bar: measure.getAttribute('number') || String(mi + 1),
        xml: serialize(measure),
      });
      offset += length;
    }
    for (const [voice, events] of voices) {
      if (!events.some((e) => e.midi !== null)) continue;
      events.sort((a, b) => a.beat - b.beat);
      tracks.push({
        id: `${part.getAttribute('id')}:${voice}`,
        name: `${names.get(part.getAttribute('id')) || 'Part'} · ${voice}`,
        events,
        measures,
        tempos,
        duration: offset,
        complex,
      });
    }
  }
  if (!tracks.length) throw new Error('empty');
  const sharedTempos = new Map();
  for (const track of tracks)
    for (const tempo of track.tempos.slice(1)) sharedTempos.set(tempo.beat, tempo.bpm);
  for (const track of tracks)
    track.tempos = [
      { beat: 0, bpm: 80 },
      ...[...sharedTempos].sort((a, b) => a[0] - b[0]).map(([beat, bpm]) => ({ beat, bpm })),
    ];
  return { title, tracks };
}
function midiXml(midi) {
  const ppq = midi.header.ppq;
  const parts = midi.tracks.filter((t) => t.notes.length);
  const tempos = midi.header.tempos.length ? midi.header.tempos : [{ ticks: 0, bpm: 80 }];
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${escapeXml(midi.name || 'MIDI score')}</work-title></work><part-list>${parts.map((t, i) => `<score-part id="P${i}"><part-name>${escapeXml(t.name || `Track ${i + 1}`)}</part-name></score-part>`).join('')}</part-list>${parts
    .map((track, pi) => {
      const notes = [...track.notes].sort((a, b) => a.ticks - b.ticks || b.midi - a.midi);
      const signature = midi.header.timeSignatures[0]?.timeSignature || [4, 4];
      const barTicks = (ppq * signature[0] * 4) / signature[1];
      const end = notes.reduce((end, n) => Math.max(end, n.ticks + n.durationTicks), 0);
      if (!(barTicks > 0) || end / barTicks > 2000) throw new Error('size');
      let out = '';
      for (let b = 0; b < Math.ceil(end / barTicks); b++) {
        const start = b * barTicks,
          stop = start + barTicks;
        let position = start,
          body = '';
        const rest = (ticks) =>
          ticks > 0 ? `<note><rest/><duration>${Math.round(ticks)}</duration></note>` : '';
        for (const tempo of tempos.filter((t) => t.ticks >= start && t.ticks < stop))
          body += `<direction><direction-type><words/></direction-type><offset>${Math.round(tempo.ticks - start)}</offset><sound tempo="${tempo.bpm}"/></direction>`;
        for (const n of notes.filter((n) => n.ticks < stop && n.ticks + n.durationTicks > start)) {
          const onset = Math.max(start, n.ticks),
            ending = Math.min(stop, n.ticks + n.durationTicks);
          if (onset < position) continue;
          body += rest(onset - position);
          const step = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][n.midi % 12],
            alter = [1, 3, 6, 8, 10].includes(n.midi % 12) ? '<alter>1</alter>' : '';
          body += `<note><pitch><step>${step}</step>${alter}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch><duration>${Math.round(ending - onset)}</duration>${n.ticks < start ? '<tie type="stop"/>' : ''}${n.ticks + n.durationTicks > stop ? '<tie type="start"/>' : ''}</note>`;
          position = ending;
        }
        body += rest(stop - position);
        out += `<measure number="${b + 1}">${b === 0 ? `<attributes><divisions>${ppq}</divisions><key><fifths>0</fifths></key><time><beats>${signature[0]}</beats><beat-type>${signature[1]}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ''}${body}</measure>`;
      }
      return `<part id="P${pi}">${out}</part>`;
    })
    .join('')}</score-partwise>`;
}
export async function importScore(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('size');
  const extension = file.name.split('.').at(-1).toLowerCase();
  let xml;
  if (['mid', 'midi'].includes(extension)) {
    const midi = new Midi(await file.arrayBuffer());
    xml = midiXml(midi);
    const score = parseMusicXml(xml);
    score.midi = true;
    score.midiWarning =
      midi.tracks.some((t) =>
        [...t.notes]
          .sort((a, b) => a.ticks - b.ticks)
          .some((n, i, a) => i > 0 && n.ticks < a[i - 1].ticks + a[i - 1].durationTicks),
      ) || midi.header.timeSignatures.length > 1;
    return score;
  }
  if (extension === 'mxl') {
    let expanded = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        expanded += entry.originalSize;
        if (expanded > 30 * 1024 * 1024) throw new Error('size');
        return !entry.name.endsWith('/');
      },
    });
    const container = files['META-INF/container.xml'];
    if (!container) throw new Error('invalid');
    const doc = new DOMParser().parseFromString(strFromU8(container), 'text/xml');
    const path = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
    if (!files[path]) throw new Error('invalid');
    xml = strFromU8(files[path]);
  } else if (['xml', 'musicxml'].includes(extension)) xml = await file.text();
  else throw new Error('format');
  return parseMusicXml(xml);
}
export function secondsAt(track, beat, tempo = null) {
  if (tempo) return (beat * 60) / tempo;
  let seconds = 0,
    previous = 0,
    bpm = 80;
  for (const change of [...track.tempos].sort((a, b) => a.beat - b.beat)) {
    if (change.beat > beat) break;
    seconds += ((change.beat - previous) * 60) / bpm;
    previous = change.beat;
    bpm = change.bpm;
  }
  return seconds + ((beat - previous) * 60) / bpm;
}
export function scoreStartAtBeat(track, beat, tempo = null) {
  if (!Number.isFinite(beat) || !track?.measures.length) return null;
  const selected = Math.max(0, Math.min(beat, track.duration - 0.000001));
  return {
    beat: selected,
    time: secondsAt(track, selected, tempo),
    bar: Math.max(
      0,
      track.measures.findLastIndex((m) => m.beat <= selected + 0.0000001),
    ),
  };
}
export function timedEvents(track, tempo) {
  return track.events.map((e, i) => ({
    ...e,
    index: i,
    start: secondsAt(track, e.beat, tempo),
    end: secondsAt(track, e.beat + e.duration, tempo),
  }));
}
export function excerptXml(track, measure, full = false) {
  const start = full ? 0 : Math.max(0, measure - 1),
    end = full ? track.measures.length : Math.min(track.measures.length, measure + 2);
  const attributes = new Map();
  for (let i = 0; i <= start; i++) {
    const doc = new DOMParser().parseFromString(track.measures[i].xml, 'text/xml');
    for (const attribute of children(child(doc.documentElement, 'attributes')))
      attributes.set(attribute.localName, serialize(attribute));
  }
  const bars = track.measures
    .slice(start, end)
    .map((m, i) => {
      const doc = new DOMParser().parseFromString(m.xml, 'text/xml'),
        root = doc.documentElement;
      for (const print of children(root, 'print')) root.removeChild(print);
      if (i === 0) {
        const old = child(root, 'attributes');
        if (old) root.removeChild(old);
        const attrs = doc.createElement('attributes');
        for (const xml of attributes.values())
          attrs.appendChild(new DOMParser().parseFromString(xml, 'text/xml').documentElement);
        root.insertBefore(attrs, root.firstChild);
      }
      return serialize(root);
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${escapeXml(track.name)}</part-name></score-part></part-list><part id="P1">${bars}</part></score-partwise>`;
}
export const DEMO_XML = `<score-partwise version="4.0"><work><work-title>Open-string melody</work-title></work><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${[
  [69, 71, 73, 74],
  [76, 74, 73, 71],
  [69, 69, 76, 76],
  [74, 73, 71, 69],
]
  .map(
    (notes, i) =>
      `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type><sound tempo="80"/></direction>' : ''}${notes.map((m) => `<note><pitch><step>${['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][m % 12]}</step>${[1, 3, 6, 8, 10].includes(m % 12) ? '<alter>1</alter>' : ''}<octave>${Math.floor(m / 12) - 1}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`,
  )
  .join('')}</part></score-partwise>`;
