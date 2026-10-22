import { VIBE_KEYS, estimateVibeKey } from './vibe.js';
import { MODEL_ID, encodeNote, performanceTokens } from './musicTransformer.js';
export function predictionRequest(session, notes, beat, engine = MODEL_ID) {
  const bar = Math.floor(beat / 4);
  if (
    session.lastGeneratedBar === bar ||
    !notes.length ||
    (notes.length < 2 && (notes[0].duration * session.bpm) / 60 < 2)
  )
    return null;
  const key =
    session.key === 'auto'
      ? estimateVibeKey(notes)
      : VIBE_KEYS.find((k) => k.id === session.key) || VIBE_KEYS[0];
  const fromBar = session.bars.length ? bar + 2 : bar + 1;
  // Include the locked next bar as a bridge after the actually performed context.
  const bridge = session.bars
    .filter((b) => b.bar === bar + 1)
    .flatMap((b) => b.events)
    .map((e) => encodeNote(e.midi, e.duration));
  return {
    predictor: engine,
    bpm: session.bpm,
    notes: [
      ...notes.map((n) => ({ ...n })),
      ...session.bars
        .filter((b) => b.bar === bar + 1)
        .flatMap((b) => b.events)
        .filter((e) => e.midi !== null)
        .map((e) => ({
          midi: e.midi,
          start: (e.beat * 60) / session.bpm,
          duration: (e.duration * 60) / session.bpm,
        })),
    ],
    tokens: [...performanceTokens(notes, session.bpm), ...bridge].slice(-64),
    fromBar,
    count: bar + 5 - fromBar,
    key,
    seed: session.seed + bar,
    requestedBar: bar,
  };
}
export function commitPrediction(session, request, bars, beat, milliseconds) {
  // Late results may never change the current bar or an already visible next bar.
  const minimum = Math.floor(beat / 4) + (session.bars.length ? 2 : 1);
  const accepted = bars.filter((b) => b.bar >= minimum);
  if (!accepted.length || session.lastGeneratedBar >= request.requestedBar) return false;
  const fromBar = accepted[0].bar;
  session.bars = [...session.bars.filter((b) => b.bar < fromBar), ...accepted];
  session.lastGeneratedBar = request.requestedBar;
  session.estimatedKey = request.key.id;
  session.predictor = request.predictor || MODEL_ID;
  session.revisions.push({
    atBeat: beat,
    fromBar,
    key: request.key.id,
    bars: accepted,
    predictor: request.predictor || MODEL_ID,
    milliseconds,
  });
  return true;
}
