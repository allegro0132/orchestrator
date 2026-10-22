import { readFileSync, writeFileSync } from 'node:fs';
import { SCORE_LIBRARY } from '../../src/scoreLibrary.js';
import { parseMusicXml } from '../../src/score.js';
const pieces = SCORE_LIBRARY.filter((s) => s.license === 'Public Domain').map((s) => ({
  id: s.id,
  title: s.title.en,
  credit: s.credit,
  source: s.sourceUrl,
  events: parseMusicXml(
    readFileSync(new URL(`../../public/scores/${s.id}.musicxml`, import.meta.url), 'utf8'),
  ).tracks[0].events.map(({ midi, duration }) => ({ midi, duration })),
}));
writeFileSync(new URL('./corpus.json', import.meta.url), JSON.stringify(pieces, null, 2) + '\n');
