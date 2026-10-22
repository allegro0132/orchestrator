export const DEFAULT_ACCURACY_CENTS = 20;
export const ACCURACY_OPTIONS = Array.from({ length: 10 }, (_, i) => (i + 1) * 5);
const STORAGE_KEY = 'arco-tuning-accuracy';
export function normalizeAccuracy(value) {
  const cents = Number(value);
  return ACCURACY_OPTIONS.includes(cents) ? cents : DEFAULT_ACCURACY_CENTS;
}
export function readAccuracy(storage) {
  try {
    return normalizeAccuracy((storage ?? globalThis.localStorage).getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ACCURACY_CENTS;
  }
}
export function saveAccuracy(value, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, String(normalizeAccuracy(value)));
  } catch {}
}
