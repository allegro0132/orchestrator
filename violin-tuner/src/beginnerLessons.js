import { escapeXml, parseMusicXml } from './score.js';
const words = (zh, en) => ({ zh, en });
const note = (midi, beats, bow, extra = {}) => ({ midi, beats, bow, ...extra });
const rest = (phase, extra = {}) => ({ midi: null, beats: 1, phase, ...extra });
const titles = {
  long: words('超慢长弓 · D 弦', 'Slow long bows · D string'),
  strings: words('四根空弦分开练', 'Four open strings, one at a time'),
  crossing: words('停—放—拉 · 两弦换弦', 'Stop, place, play · string crossings'),
};
const bowSetup = words(
  '从弓中段开始，先在 D 弦放稳弓；对镜观察弓是否走直。',
  'Start at the middle of the bow. Settle on the D string and use a mirror to watch the bow travel straight.',
);
export const BEGINNER_LESSONS = [
  {
    id: 'long-bows',
    category: 'bow',
    title: titles.long,
    bpm: 40,
    minutes: 4,
    goal: words(
      '稳定接触点，让弓走直；声音连贯、均匀。',
      'Keep the contact point steady, the bow straight, and the sound connected and even.',
    ),
    setup: bowSetup,
    steps: [
      words(
        'D 弦空弦，下弓 4 拍、上弓 4 拍，连续 8 组。',
        'Play open D: four beats down-bow, four beats up-bow, for eight pairs.',
      ),
      words(
        '换弓尽量连贯，不要突然加压或让声音忽大忽小。',
        'Connect the bow changes without sudden pressure or changes in loudness.',
      ),
    ],
    checks: [
      words(
        '接触点没有漂向指板或琴码',
        'The contact point stayed away from drifting toward the fingerboard or bridge',
      ),
      words('换弓没有明显顿挫', 'Bow changes felt smooth'),
      words('声音的开头与结尾同样稳定', 'The beginning and end of each bow sounded equally steady'),
    ],
    cues: Array.from({ length: 8 }, (_, i) => [
      note(62, 4, 'down', { group: i + 1, total: 8 }),
      note(62, 4, 'up', { group: i + 1, total: 8 }),
    ]).flat(),
  },
  {
    id: 'open-strings',
    category: 'bow',
    title: titles.strings,
    bpm: 40,
    minutes: 4,
    goal: words(
      '适应每根弦的右臂高度，建立稳定的落弓姿势。',
      'Find the right arm level and a settled bow position for each string.',
    ),
    setup: words(
      '顺序 D → A → G → E。每根弦先单独放稳弓，再开始拉。',
      'Follow D → A → G → E. Settle the bow on each string before playing.',
    ),
    steps: [
      words(
        '每根弦做 4 组下弓＋上弓，每弓 4 拍。',
        'On each string, play four down/up pairs, four beats per bow.',
      ),
      words(
        '换弦前留 4 拍停顿，重新落弓找位置；不要急着连续换弦。',
        'Take four beats between strings to stop and place the bow again. Do not rush the crossing.',
      ),
    ],
    checks: [
      words('每根弦的右臂高度合适', 'The right arm settled at a suitable level for each string'),
      words('落弓放稳后才开始拉', 'The bow was settled before playing'),
      words('始终只响一根弦', 'Only one string sounded at a time'),
    ],
    cues: [62, 69, 55, 76].flatMap((midi, si) => [
      ...(si ? [{ midi: null, beats: 4, phase: 'place', nextMidi: midi }] : []),
      ...Array.from({ length: 4 }, (_, i) => [
        note(midi, 4, 'down', { group: i + 1, total: 4 }),
        note(midi, 4, 'up', { group: i + 1, total: 4 }),
      ]).flat(),
    ]),
  },
  {
    id: 'crossings',
    category: 'bow',
    title: titles.crossing,
    bpm: 50,
    minutes: 3,
    goal: words(
      '先换得准确，再追求连续；每次只响一根弦。',
      'Make each crossing accurate before making it continuous. Sound only one string.',
    ),
    setup: words(
      '先在 D 弦放好弓。换弦时调整右臂高度，把弓放稳再拉。',
      'Place the bow on D first. Adjust the right arm level for the next string and settle before playing.',
    ),
    steps: [
      words(
        '依次练 D–A–D–A、A–E–A–E、D–G–D–G；每种组合做 4 轮。',
        'Practice D–A–D–A, A–E–A–E, then D–G–D–G; repeat each pattern four times.',
      ),
      words(
        '每音拉 1 拍 → 停 1 拍 → 放稳下一根弦 1 拍，再拉下一个音。',
        'Play one beat → stop for one beat → place on the next string for one beat, then play.',
      ),
    ],
    checks: [
      words('停弓之后才调整右臂', 'The bow stopped before the arm changed level'),
      words('下一根弦放稳后才发声', 'The next string was settled before sounding'),
      words('没有同时碰响两根弦', 'Two strings did not sound together'),
    ],
    cues: (() => {
      const notes = [
        [62, 69],
        [69, 76],
        [62, 55],
      ].flatMap(([a, b], pi) =>
        Array.from({ length: 4 }, (_, i) =>
          [a, b, a, b].map((midi, j) =>
            note(midi, 1, j % 2 ? 'up' : 'down', { group: i + 1, total: 4, pair: pi }),
          ),
        ).flat(),
      );
      return notes.flatMap((n, i) => [
        n,
        rest('stop', { group: n.group, total: 4, pair: n.pair }),
        rest(i === notes.length - 1 ? 'finish' : 'place', {
          nextMidi: notes[i + 1]?.midi,
          group: n.group,
          total: 4,
          pair: n.pair,
        }),
      ]);
    })(),
  },
  ...[
    {
      id: 'finger-1',
      title: words('左手第 1 组 · 食指', 'Left hand 1 · first finger'),
      pattern: [0, 1, 0, 1, 0],
      goal: words(
        '自然弯曲食指，找到 D 弦的 E 音。',
        'Curve the first finger naturally and find E on the D string.',
      ),
      setup: words(
        '先拉 D 空弦；在 E 音位置落下食指，手腕保持自然，再轻轻抬起。',
        'Start with open D. Place the curved first finger for E with a natural wrist, then release it gently.',
      ),
      checks: [
        words(
          '抬指只稍稍离开琴弦，没有抬得很高',
          'The finger lifted only slightly above the string',
        ),
        words('手腕保持自然，E 音清晰', 'The wrist stayed natural and E sounded clear'),
      ],
    },
    {
      id: 'finger-2',
      title: words('左手第 2 组 · 1、2 指', 'Left hand 2 · first and second fingers'),
      pattern: [0, 1, 2, 1, 0],
      goal: words(
        '加入中指，练准 E 与 F♯。',
        'Add the second finger and place E and F♯ accurately.',
      ),
      setup: words(
        '食指按 E，中指按 F♯；按指时不要突然夹紧拇指。',
        'Place the first finger on E and the second on F♯. Avoid suddenly gripping with the thumb.',
      ),
      checks: [
        words(
          '中指按下时，食指仍然自然',
          'The first finger stayed natural when the second finger landed',
        ),
        words('拇指没有突然夹紧', 'The thumb did not suddenly grip'),
        words('指尖没有碰到相邻琴弦', 'The fingertips stayed clear of neighboring strings'),
      ],
    },
    {
      id: 'finger-3',
      title: words('左手第 3 组 · 加入 3 指', 'Left hand 3 · add the third finger'),
      pattern: [0, 1, 2, 3, 2, 1, 0],
      goal: words(
        '加入无名指，掌握 F♯–G 的半音距离。',
        'Add the third finger and learn the semitone between F♯ and G.',
      ),
      setup: words(
        '2 指 F♯ 与 3 指 G 靠近；先按准，再逐渐提速。',
        'Keep the second finger on F♯ close to the third finger on G. Find the pitch before increasing speed.',
      ),
      checks: [
        words('2 指与 3 指距离较近', 'The second and third fingers stayed close'),
        words(
          '每个音先清晰、准确，再换下一个',
          'Each note was clear and accurate before moving on',
        ),
      ],
    },
    {
      id: 'finger-4',
      title: words('左手第 4 组 · 加入 4 指', 'Left hand 4 · add the fourth finger'),
      pattern: [0, 1, 2, 3, 4, 3, 2, 1, 0],
      goal: words(
        '加入小指，在自然手型下找到 A 音。',
        'Add the fourth finger and find A with a natural hand shape.',
      ),
      setup: words(
        '不要为够到 4 指扭曲手腕或紧捏琴颈；够不到时先放慢，调整整个左手的位置。',
        'Do not twist the wrist or squeeze the neck to reach the fourth finger. Slow down and adjust the whole left hand if needed.',
      ),
      checks: [
        words('够到小指时没有扭曲手腕', 'The wrist did not twist to reach the fourth finger'),
        words('拇指和琴颈没有越捏越紧', 'The thumb and neck grip did not become tighter'),
        words('小指落下后 A 音清晰', 'A sounded clear when the fourth finger landed'),
      ],
    },
  ].map((item) => ({
    ...item,
    category: 'hand',
    bpm: 50,
    steps: [
      words(
        '始终在 D 弦练习；每音 2 拍，整组重复 4 轮。',
        'Stay on the D string. Play each note for two beats and repeat the pattern four times.',
      ),
      words(
        '空弦为 0 指；按下时指尖自然弯曲，抬起时只离弦一点。',
        'Open string is finger 0. Curve the fingertips naturally and lift only a little when releasing.',
      ),
    ],
    cues: Array.from({ length: 4 }, (_, i) =>
      item.pattern.map((finger, j) =>
        note([62, 64, 66, 67, 69][finger], 2, (i * item.pattern.length + j) % 2 ? 'up' : 'down', {
          finger,
          group: i + 1,
          total: 4,
        }),
      ),
    ).flat(),
  })),
];
export const localize = (value, lang) => value?.[lang] || value?.en || '';
export function lessonScore(lesson) {
  let beat = 0,
    bars = [],
    body = '';
  const flush = () => {
    bars.push(
      `<measure number="${bars.length + 1}">${bars.length ? '' : `<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${lesson.bpm}</per-minute></metronome></direction-type><sound tempo="${lesson.bpm}"/></direction>`}${body}</measure>`,
    );
    body = '';
    beat = 0;
  };
  lesson.cues.forEach((cue) => {
    const type = cue.beats === 4 ? 'whole' : cue.beats === 2 ? 'half' : 'quarter';
    const midi = cue.midi;
    const pitch =
      midi === null
        ? '<rest/>'
        : `<pitch><step>${['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][midi % 12]}</step>${[1, 3, 6, 8, 10].includes(midi % 12) ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
    const technical = [
      cue.bow ? `<${cue.bow}-bow/>` : '',
      cue.finger !== undefined ? `<fingering>${cue.finger}</fingering>` : '',
    ].join('');
    body += `<note>${pitch}<duration>${cue.beats}</duration><type>${type}</type>${technical ? `<notations><technical>${technical}</technical></notations>` : ''}</note>`;
    beat += cue.beats;
    if (beat === 4) flush();
  });
  if (body) flush();
  return parseMusicXml(
    `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${escapeXml(lesson.title.en)}</work-title></work><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${bars.join('')}</part></score-partwise>`,
  );
}
