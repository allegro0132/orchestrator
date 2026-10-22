import { VIBE_KEYS } from './vibe.js';
import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT } from './skyWeights.js';
export const VIBE_TEMPOS = [40, 50, 60, 70, 80, 90, 100, 110, 120];
export const VIBE_PREFERENCES_KEY = 'arco-vibe-preferences-v1';
export function normalizeVibePreferences(value) {
  return {
    engine: [RULE_MODEL_ID, SKY_DEPLOYMENT].includes(value?.engine) ? value.engine : RULE_MODEL_ID,
    bpm: VIBE_TEMPOS.includes(value?.bpm) ? value.bpm : 60,
    key:
      value?.key === 'auto' || VIBE_KEYS.some((key) => key.id === value?.key) ? value.key : 'auto',
  };
}
export function readVibePreferences(storage) {
  try {
    return normalizeVibePreferences(
      JSON.parse((storage || globalThis.localStorage).getItem(VIBE_PREFERENCES_KEY)),
    );
  } catch {
    return normalizeVibePreferences(null);
  }
}
export function writeVibePreferences(value, storage) {
  try {
    (storage || globalThis.localStorage).setItem(
      VIBE_PREFERENCES_KEY,
      JSON.stringify(normalizeVibePreferences(value)),
    );
    return true;
  } catch {
    return false;
  }
}
