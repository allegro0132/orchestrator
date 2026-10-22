import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { readFile } from 'node:fs/promises';
import { createScoreAnalysis } from './scoreAnalysis.js';

test('expanded note analysis renders completed notes, missing readings and seek ranges in both languages', async () => {
  const sourceUrl = new URL('./ScoreAnalysisTable.jsx', import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const { code } = await transformWithEsbuild(source, sourceUrl.pathname, { loader: 'jsx' });
  const resolved = code.replace(
    /from (["'])(.*?)\1/g,
    (_, quote, specifier) =>
      `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, sourceUrl).href : import.meta.resolve(specifier))}`,
  );
  const { default: ScoreAnalysisTable } = await import(
    `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`
  );
  const events = [
    { index: 0, bar: 1, midi: 62, start: 0, end: 1 },
    { index: 1, bar: 1, midi: null, start: 1, end: 2 },
    { index: 2, bar: 2, midi: 66, start: 2, end: 3 },
    { index: 3, bar: 2, midi: 69, start: 3, end: 4 },
    { index: 4, bar: 3, midi: 71, start: 4, end: 5 },
  ];
  const analysis = createScoreAnalysis(events);
  Object.assign(analysis.results[2], { samples: 4, accurate: 3, voicedSeconds: 0.5, onset: -0.1 });
  analysis.feedback.outcomes[2] = { type: 'good' };
  analysis.feedback.outcomes[3] = { type: 'miss' };
  for (const lang of ['en', 'zh']) {
    const text = (zh, en) => (lang === 'zh' ? zh : en);
    const render = () =>
      renderToStaticMarkup(
        React.createElement(ScoreAnalysisTable, { events, analysis, time: 4, text }),
      );
    const markup = render();
    assert.match(markup, /D4/);
    assert.match(markup, /F♯4/);
    assert.match(markup, /A4/);
    assert.doesNotMatch(markup, /B4/);
    assert.match(markup, /Good/);
    assert.match(markup, lang === 'zh' ? /漏音/ : /Miss/);
    assert.match(markup, /75%/);
    assert.match(markup, /50%/);
    assert.match(markup, /-100 ms/);
    assert.match(markup, lang === 'zh' ? /未检测到/ : /Not detected/);
    assert.equal((markup.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 3);
    analysis.from = 2;
    assert.doesNotMatch(render(), /D4/);
    analysis.from = 0;
  }
  const changedTrack = events.map((event) => ({ ...event, midi: 76 }));
  assert.equal(
    renderToStaticMarkup(
      React.createElement(ScoreAnalysisTable, {
        events: changedTrack,
        analysis,
        time: 4,
        text: (_, en) => en,
      }),
    ),
    '',
  );
});
