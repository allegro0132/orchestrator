export const STRINGS = [
  { name: 'G', midi: 55, label: '四弦', color: '#ad8260' },
  { name: 'D', midi: 62, label: '三弦', color: '#bc9366' },
  { name: 'A', midi: 69, label: '二弦', color: '#717b58' },
  { name: 'E', midi: 76, label: '一弦', color: '#b78565' },
];
export const PATTERNS = [
  { name: '自然手型', sub: '高二指 · 低三指', steps: [2, 4, 5, 7] },
  { name: '低二指手型', sub: '低二指 · 低三指', steps: [2, 3, 5, 7] },
  { name: '高三指手型', sub: '高二指 · 高三指', steps: [2, 4, 6, 7] },
  { name: '低一指手型', sub: '低一指 · 低二指', steps: [1, 3, 5, 7] },
];
export const frequency = (midi, a = 440) => a * 2 ** ((midi - 69) / 12);
export const centsOff = (hz, target) => 1200 * Math.log2(hz / target);
export function noteName(midi) {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  return { name: names[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1 };
}
// Normalized square difference, with the first strong minimum selected to avoid octave errors.
export function detectPitch(buffer, sampleRate, minHz = 170) {
  let power = 0;
  for (const x of buffer) power += x * x;
  if (Math.sqrt(power / buffer.length) < 0.002) return null;
  const min = Math.floor(sampleRate / 2400),
    max = Math.min(Math.floor(sampleRate / minHz), Math.floor(buffer.length / 2) - 1);
  const values = new Float32Array(max + 1);
  let best = 0,
    bestScore = 0;
  for (let lag = min; lag <= max; lag++) {
    let cross = 0,
      energy = 0;
    for (let i = 0; i < buffer.length - max; i++) {
      cross += buffer[i] * buffer[i + lag];
      energy += buffer[i] ** 2 + buffer[i + lag] ** 2;
    }
    values[lag] = energy ? (2 * cross) / energy : 0;
    bestScore = Math.max(bestScore, values[lag]);
  }
  if (bestScore < 0.8) return null;
  for (let lag = min + 1; lag < max; lag++) {
    if (
      values[lag] > Math.max(0.85, bestScore * 0.94) &&
      values[lag] > values[lag - 1] &&
      values[lag] >= values[lag + 1]
    ) {
      best = lag;
      break;
    }
  }
  if (!best) return null;
  const left = values[best - 1],
    mid = values[best],
    right = values[best + 1];
  const offset = (left - right) / (2 * (left - 2 * mid + right)) || 0;
  return sampleRate / (best + offset);
}
