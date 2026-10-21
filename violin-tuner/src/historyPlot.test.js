import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyPlot } from './historyPlot.js';

test('keeps a fixed range and marks out-of-range readings at the edges', () => {
  const cents = [0, 2, 25, 60, 170, -240, 1200];
  const samples = cents.map((c, i) => ({ time: i * 100, cents: c }));
  const plot = historyPlot(samples, 600);
  assert.equal(plot.range, 50);
  assert.equal(plot.segments.flat().length, cents.length);
  assert.equal(plot.segments.flat().filter((p) => p.overflow).length, 4);
  assert.equal(plot.y(60), plot.y(1200));
  assert.equal(plot.y(-240), 92);
  for (const p of plot.segments.flat()) assert.ok(p.y >= 16 && p.y <= 92);
  assert.equal(plot.y(0), 54);
  assert.ok(plot.y(5) > plot.y(25));
});
test('retains isolated readings, preserves silence gaps and drops expired data', () => {
  const plot = historyPlot(
    [
      { time: 0, cents: 1000 },
      { time: 1000, cents: 25 },
      { time: 1100, cents: null },
      { time: 1200, cents: -35 },
      { time: 2000, cents: 8 },
    ],
    6500,
  );
  assert.equal(plot.range, 50);
  assert.deepEqual(
    plot.segments.map((s) => s.length),
    [1, 1, 1],
  );
  assert.equal(historyPlot([], 0).segments.length, 0);
  assert.equal(historyPlot([{ time: 0, cents: null }], 0).current, null);
});
