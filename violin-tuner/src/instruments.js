import { STRINGS, PATTERNS } from './pitch.js';
export const INSTRUMENTS = {
  violin: {
    id: 'violin',
    en: 'Violin',
    zh: '小提琴',
    strings: STRINGS,
    minHz: 170,
    minMidi: 55,
    maxMidi: 83,
  },
  guitar: {
    id: 'guitar',
    en: 'Guitar',
    zh: '吉他',
    minHz: 65,
    minMidi: 40,
    maxMidi: 76,
    strings: [40, 45, 50, 55, 59, 64].map((midi, i) => ({
      midi,
      name: ['E', 'A', 'D', 'G', 'B', 'E'][i],
      label: ['六弦', '五弦', '四弦', '三弦', '二弦', '一弦'][i],
    })),
  },
};
export function readInstrument(storage = globalThis.localStorage) {
  try {
    return INSTRUMENTS[storage?.getItem('arco-instrument')]
      ? storage.getItem('arco-instrument')
      : 'violin';
  } catch {
    return 'violin';
  }
}
export function targetMidiFor(instrument, string, finger = 0, position = 0, pattern = 0) {
  const base = INSTRUMENTS[instrument]?.strings[string]?.midi;
  return (
    base +
    (finger
      ? instrument === 'guitar'
        ? position + finger
        : [0, 2, 4, 5, 7][position] + PATTERNS[pattern].steps[finger - 1]
      : 0)
  );
}
