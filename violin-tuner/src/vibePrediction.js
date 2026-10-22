import { VIBE_KEYS, estimateVibeKey } from './vibe.js';
import { MODEL_ID, encodeNote, performanceTokens } from './musicTransformer.js';
export function clearVibeContext(session) {
  session.contextEpoch = (session.contextEpoch || 0) + 1;
  session.contextSince = session.elapsed;
  session.contextStartBar = (session.bars.at(-1)?.bar ?? -1) + 1;
  session.lastGeneratedBar = -1;
  (session.contextResets ||= []).push({
    at: session.elapsed,
    epoch: session.contextEpoch,
    fromBar: session.contextStartBar,
  });
}
export function predictionRequest(session, notes, beat, engine = MODEL_ID) {
  const bar = Math.floor(beat / 4),
    since = session.contextSince || 0;
  const context = notes
    .filter((n) => n.start + n.duration > since)
    .map((n) => ({
      ...n,
      start: Math.max(since, n.start),
      duration: n.start + n.duration - Math.max(since, n.start),
    }));
  if (!context.length || (context.length < 2 && (context[0].duration * session.bpm) / 60 < 2))
    return null;
  const fromBar = Math.max(
    bar + (session.bars.length ? 2 : 1),
    (session.bars.at(-1)?.bar ?? -1) + 1,
  );
  const count = bar + 5 - fromBar;
  if (count <= 0) return null;
  const key =
    session.key === 'auto'
      ? estimateVibeKey(context)
      : VIBE_KEYS.find((k) => k.id === session.key) || VIBE_KEYS[0];
  // Continue from the immutable tail, excluding every pre-reset generated bar.
  const bridge = session.bars
    .filter((b) => b.bar >= (session.contextStartBar || 0))
    .slice(-1)
    .flatMap((b) => b.events);
  return {
    predictor: engine,
    bpm: session.bpm,
    notes: [
      ...context,
      ...bridge
        .filter((e) => e.midi !== null)
        .map((e) => ({
          midi: e.midi,
          start: (e.beat * 60) / session.bpm,
          duration: (e.duration * 60) / session.bpm,
        })),
    ],
    tokens: [
      ...performanceTokens(context, session.bpm),
      ...bridge.map((e) => encodeNote(e.midi, e.duration)),
    ].slice(-64),
    fromBar,
    count,
    key,
    seed: session.seed + bar + (session.contextEpoch || 0) * 997,
    requestedBar: bar,
    contextEpoch: session.contextEpoch || 0,
  };
}
export function commitPrediction(session, request, bars, beat, milliseconds) {
  if ((request.contextEpoch || 0) !== (session.contextEpoch || 0)) return false;
  const tail = session.bars.at(-1)?.bar ?? -1;
  const minimum = Math.floor(beat / 4) + 1;
  const accepted = bars
    .filter((b) => b.bar > tail && b.bar >= minimum)
    .toSorted((a, b) => a.bar - b.bar);
  if (!accepted.length) return false;
  let expected = tail < 0 ? accepted[0].bar : tail + 1;
  const appended = [];
  for (const bar of accepted) {
    if (bar.bar < expected) continue;
    let cursor = bar.bar * 4;
    for (const e of bar.events) {
      if (
        e.beat !== cursor ||
        !(e.duration > 0) ||
        (e.midi !== null && (!Number.isInteger(e.midi) || e.midi < 55 || e.midi > 83))
      )
        return false;
      cursor += e.duration;
    }
    if (cursor !== (bar.bar + 1) * 4) return false;
    // If inference missed a deadline, retain its place in the timeline as silence.
    while (expected < bar.bar) {
      appended.push({
        bar: expected,
        key: request.key.id,
        missed: true,
        events: [{ midi: null, beat: expected * 4, duration: 4 }],
      });
      expected++;
    }
    appended.push(bar);
    expected++;
  }
  if (!appended.length) return false;
  session.bars = [...session.bars, ...appended];
  session.lastGeneratedBar = request.requestedBar;
  session.estimatedKey = request.key.id;
  session.predictor = request.predictor || MODEL_ID;
  session.revisions.push({
    atBeat: beat,
    fromBar: appended[0].bar,
    key: request.key.id,
    bars: appended,
    predictor: session.predictor,
    milliseconds,
    contextEpoch: session.contextEpoch || 0,
  });
  return true;
}
export function vibeDisplayTrack(session) {
  if (!session.bars.length) return null;
  const windowBeat = session.bars[0].bar * 4;
  return {
    id: session.id,
    streamId: session.id,
    name: 'Generated continuation',
    windowBeat,
    duration: (session.bars.at(-1).bar + 1) * 4 - windowBeat,
    bpm: session.bpm,
    streamBars: session.bars,
    measures: session.bars.map((b) => ({
      beat: b.bar * 4 - windowBeat,
      duration: 4,
      bar: String(b.bar + 1),
    })),
  };
}
