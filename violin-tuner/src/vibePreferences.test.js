import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVibePreferences,
  readVibePreferences,
  writeVibePreferences,
  VIBE_PREFERENCES_KEY,
} from './vibePreferences.js';
import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT } from './skyWeights.js';
import { newVibeSession } from './vibe.js';
const defaults = { engine: RULE_MODEL_ID, bpm: 60, key: 'auto' };
const storage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
test('first use keeps rule-based, 60 BPM and automatic key defaults', () => {
  assert.deepEqual(readVibePreferences(storage()), defaults);
});
test('selected settings survive reload and initialize new takes without loading GPU weights', () => {
  const local = storage(),
    chosen = { engine: SKY_DEPLOYMENT, bpm: 90, key: 'Am' };
  assert.equal(writeVibePreferences({ ...chosen, modelEnabled: true, elapsed: 12 }, local), true);
  assert.deepEqual(readVibePreferences(local), chosen);
  const restored = readVibePreferences(local),
    take = newVibeSession(restored.bpm, restored.key);
  assert.equal(take.bpm, 90);
  assert.equal(take.key, 'Am');
  assert.equal(take.elapsed, 0);
  assert.deepEqual(take.notes, []);
  assert.equal('modelEnabled' in JSON.parse(local.getItem(VIBE_PREFERENCES_KEY)), false);
});
test('malformed storage and unsupported values safely recover supported defaults', () => {
  const local = storage();
  for (const raw of ['broken', 'null', '[]', '42']) {
    local.setItem(VIBE_PREFERENCES_KEY, raw);
    assert.deepEqual(readVibePreferences(local), defaults);
  }
  assert.deepEqual(
    normalizeVibePreferences({ engine: 'retired-model', bpm: '90', key: 'bad' }),
    defaults,
  );
  assert.deepEqual(normalizeVibePreferences({ engine: SKY_DEPLOYMENT, bpm: 999, key: 'D' }), {
    engine: SKY_DEPLOYMENT,
    bpm: 60,
    key: 'D',
  });
});
test('blocked browser storage never prevents using the current settings', () => {
  const blocked = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.deepEqual(readVibePreferences(blocked), defaults);
  assert.equal(writeVibePreferences(defaults, blocked), false);
});
