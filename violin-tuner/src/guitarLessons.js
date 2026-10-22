const words = (zh, en) => ({ zh, en });
const build = (id, title, midis, frets, strings, category = 'bow') => ({
  id,
  title,
  category,
  instrument: 'guitar',
  bpm: 60,
  goal: words(
    '一次只弹一个音，让音高和节奏都清晰稳定。',
    'Play one note at a time with clear pitch and steady timing.',
  ),
  setup: words(
    '放松肩膀与手腕，用指尖或拨片轻拨单弦，每音两拍。',
    'Relax your shoulders and wrists. Pluck one string gently with a fingertip or pick, two beats per note.',
  ),
  steps: [
    words(
      '跟随预备拍。每组重复四轮，换弦前先放稳右手。',
      'Follow the count-in. Repeat four rounds and settle your picking hand before changing strings.',
    ),
    words(
      '按品时指尖靠近品丝，不要按在品丝上；休息时放松拇指。',
      'Place the fingertip just behind the fret, rather than on it. Release thumb pressure during rests.',
    ),
  ],
  checks: [
    words('只响目标弦，没有碰响邻弦', 'Only the intended string sounded'),
    words('每个音清晰，没有打品或杂音', 'Each note was clear, without buzzing'),
    words('手腕自然、拇指没有夹紧', 'The wrist stayed natural and the thumb relaxed'),
  ],
  cues: Array.from({ length: 4 }, (_, round) =>
    midis.map((midi, i) => ({
      midi,
      beats: 2,
      fret: frets[i],
      string: strings[i],
      group: round + 1,
      total: 4,
    })),
  ).flat(),
});
export const GUITAR_LESSONS = [
  build(
    'guitar-open',
    words('六根空弦 · 单音拨弦', 'Six open strings · single-note plucking'),
    [40, 45, 50, 55, 59, 64],
    [0, 0, 0, 0, 0, 0],
    [6, 5, 4, 3, 2, 1],
  ),
  build(
    'guitar-crossing',
    words('换弦 · 高音 E 与 B', 'String changes · high E and B'),
    [64, 59, 64, 59],
    [0, 0, 0, 0],
    [1, 2, 1, 2],
  ),
  build(
    'guitar-frets',
    words('半音练习 · 1–2–3–4 品', 'Chromatic practice · frets 1–2–3–4'),
    [65, 66, 67, 68, 67, 66, 65, 64],
    [1, 2, 3, 4, 3, 2, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    'hand',
  ),
];
