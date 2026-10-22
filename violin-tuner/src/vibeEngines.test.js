import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RULE_MODEL_ID, generateVibeBars } from './vibeRules.js';
import { predictionRequest, commitPrediction } from './vibePrediction.js';
import { newVibeSession, VIBE_KEYS } from './vibe.js';
import { SKY_DEPLOYMENT, loadSkyWeights, verified } from './skyWeights.js';
const notes = [62, 64, 66, 67].map((midi, i) => ({ midi, start: i, duration: 1 }));
test('rules preserve contour deterministically within violin range and exact bars', () => {
  const bars = generateVibeBars(notes, 3, 4, 60, VIBE_KEYS[0], 17);
  assert.deepEqual(bars, generateVibeBars(notes, 3, 4, 60, VIBE_KEYS[0], 17));
  for (const b of bars) {
    assert.equal(
      b.events.reduce((s, e) => s + e.duration, 0),
      4,
    );
    for (const e of b.events) assert.ok(e.midi >= 55 && e.midi <= 83);
  }
});
test('engine switches preserve locked bars and record the actual provider', () => {
  const s = newVibeSession();
  let r = predictionRequest(s, notes, 2, RULE_MODEL_ID);
  assert.ok(commitPrediction(s, r, generateVibeBars(notes, r.fromBar, r.count, 60, r.key), 2, 1));
  const locked = structuredClone(s.bars.filter((b) => b.bar < 3));
  s.lastGeneratedBar = -1;
  r = predictionRequest(s, notes, 4, SKY_DEPLOYMENT);
  assert.ok(r.notes.length > notes.length);
  assert.ok(commitPrediction(s, r, generateVibeBars(notes, r.fromBar, r.count, 60, r.key), 4, 900));
  assert.deepEqual(
    s.bars.filter((b) => b.bar < 3),
    locked,
  );
  assert.equal(s.revisions[0].predictor, RULE_MODEL_ID);
  assert.equal(s.revisions[1].predictor, SKY_DEPLOYMENT);
});
test('published weight shards reconstruct exactly the tested W4A16 artifacts', () => {
  const root = new URL(`../public/models/${SKY_DEPLOYMENT}/`, import.meta.url);
  const m = JSON.parse(readFileSync(new URL('manifest.json', root)));
  let total = 0;
  for (const f of Object.values(m.files)) {
    const buffers = f.shards.map((s) => {
      const b = readFileSync(new URL(s.name, root));
      assert.equal(b.length, s.bytes);
      assert.equal(createHash('sha256').update(b).digest('hex'), s.sha256);
      assert.ok(b.length < 100 * 1024 * 1024);
      return b;
    });
    const all = Buffer.concat(buffers);
    assert.equal(all.length, f.bytes);
    assert.equal(createHash('sha256').update(all).digest('hex'), f.sha256);
    total += all.length;
  }
  assert.equal(total, 144494146);
});
test('checksum rejects corrupt or truncated cached weights', async () => {
  await assert.rejects(
    () => verified(new Uint8Array([1]).buffer, { bytes: 2, sha256: '' }),
    /checksum/,
  );
});
test('unknown manifest versions fail before downloading weight shards', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadSkyWeights(new URL('https://example.test/'), () => {}, {
        fetcher: async () => {
          calls++;
          return Response.json({ id: 'unknown' });
        },
      }),
    /version/,
  );
  assert.equal(calls, 1);
});
