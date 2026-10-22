import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  MusicTransformer,
  MODEL_ID,
  encodeNote,
  decodeNote,
  performanceTokens,
  predictBars,
} from './musicTransformer.js';
import { predictionRequest, commitPrediction } from './vibePrediction.js';
import { newVibeSession, VIBE_KEYS, vibeTrack } from './vibe.js';
const metadata = JSON.parse(
  readFileSync(new URL('../public/models/arco-mt-v1.json', import.meta.url)),
);
const bytes = readFileSync(new URL('../public/models/arco-mt-v1.bin', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const model = () => new MusicTransformer(metadata, buffer);
test('bundled model is trained, versioned and integrity checked', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
  assert.equal(metadata.training.trainPieces.length, 5);
  assert.ok(!metadata.training.trainPieces.includes(metadata.training.holdout));
  assert.ok(metadata.training.selectedStep > 0);
  assert.ok(metadata.training.validationLoss < metadata.training.initialValidationLoss);
  assert.equal(metadata.bytes, bytes.byteLength);
  assert.throws(() => new MusicTransformer(metadata, new ArrayBuffer(4)));
});
test('cached JavaScript relative attention matches causal PyTorch logits at every step', () => {
  const cases = JSON.parse(
    readFileSync(new URL('../scripts/music-transformer/reference.json', import.meta.url)),
  );
  for (const fixture of cases) {
    const decoder = model();
    fixture.tokens.forEach((token, index) => {
      const logits = decoder.step(token);
      let error = 0;
      for (let i = 0; i < logits.length; i++)
        error = Math.max(error, Math.abs(logits[i] - fixture.logits[index][i]));
      assert.ok(error < 2e-5, `logit error ${error}`);
    });
  }
});
test('tokenizer covers rests, rhythms, high violin notes and bounded performance context', () => {
  for (let token = 1; token <= 180; token++) {
    const event = decodeNote(token);
    assert.equal(encodeNote(event.midi, event.duration), token);
  }
  assert.equal(decodeNote(encodeNote(90, 1)).midi, 78);
  assert.deepEqual(performanceTokens([{ midi: 62, start: 1, duration: 0.5 }], 60), [
    0,
    encodeNote(null, 1),
    encodeNote(62, 0.5),
  ]);
  assert.equal(
    performanceTokens(
      Array.from({ length: 100 }, (_, i) => ({ midi: 62, start: i, duration: 1 })),
      60,
    ).length,
    64,
  );
});
test('actual trained model generates deterministic full playable bars with key/rhythm masks', () => {
  const request = {
    tokens: [0, encodeNote(62, 1), encodeNote(64, 1), encodeNote(66, 1)],
    fromBar: 2,
    count: 4,
    key: VIBE_KEYS[0],
    seed: 17,
  };
  const bars = predictBars(model(), request);
  assert.deepEqual(predictBars(model(), request), bars);
  for (const bar of bars) {
    assert.equal(
      bar.events.reduce((sum, e) => sum + e.duration, 0),
      4,
    );
    let beat = bar.bar * 4;
    for (const event of bar.events) {
      assert.equal(event.beat, beat);
      beat += event.duration;
      if (event.midi !== null) {
        assert.ok(event.midi >= 55 && event.midi <= 83);
        assert.ok([0, 2, 4, 5, 7, 9, 11].includes((event.midi - 62 + 120) % 12));
      }
    }
  }
  assert.ok(
    vibeTrack(
      bars.flatMap((b) => b.events),
      60,
    ).events.length,
  );
  const altered = predictBars(model(), {
    ...request,
    tokens: [0, encodeNote(74, 2), encodeNote(71, 2), encodeNote(69, 2)],
  });
  assert.notDeepEqual(altered, bars, 'predictions depend on played context');
});
test('asynchronous commits preserve current/next bars, reject stale revisions and record model provenance', () => {
  const session = newVibeSession(60, 'D');
  const notes = [
    { midi: 62, start: 0, duration: 1 },
    { midi: 64, start: 1, duration: 1 },
  ];
  const request = predictionRequest(session, notes, 2);
  const bars = predictBars(model(), request);
  assert.ok(commitPrediction(session, request, bars, 2, 30));
  assert.equal(session.predictor, MODEL_ID);
  assert.equal(session.revisions[0].predictor, MODEL_ID);
  assert.equal(predictionRequest(session, notes, 3), null);
  const locked = structuredClone(session.bars.filter((b) => b.bar < 3));
  const next = predictionRequest(session, notes, 4);
  // Inference crosses a bar boundary: the newly current and next bars remain fixed.
  assert.ok(commitPrediction(session, next, predictBars(model(), next), 8, 30));
  assert.deepEqual(
    session.bars.filter((b) => b.bar < 3),
    locked,
  );
  assert.equal(session.revisions[1].fromBar, 5);
  assert.equal(commitPrediction(session, request, bars, 8, 30), false);
  assert.equal(commitPrediction(session, next, bars, 100, 30), false);
});
