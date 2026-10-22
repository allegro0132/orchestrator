import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfToFloat, sampleSkyLogits } from './skyDecoder.js';
import { compareSkyChoices } from './skyPrecision.js';
test('decodes IEEE FP16 values including subnormals, signed zero and non-finite values', () => {
  assert.equal(halfToFloat(0x3c00), 1);
  assert.equal(halfToFloat(0xc000), -2);
  assert.equal(halfToFloat(0x0001), 2 ** -24);
  assert.equal(halfToFloat(0x7bff), 65504);
  assert.equal(halfToFloat(0x7c00), Infinity);
  assert.ok(Number.isNaN(halfToFloat(0x7e00)));
  assert.ok(Object.is(halfToFloat(0x8000), -0));
});
test('precision comparison is invariant to a constant logit shift and detects changed pitch preferences', () => {
  const baseline = [{ note: 0, position: 5, allowed: [2407, 2408], logits: [3, 0] }];
  const shifted = [{ ...baseline[0], logits: [103, 100] }];
  const same = compareSkyChoices(baseline, shifted);
  assert.equal(same.pitch.top1Agreement, 1);
  assert.ok(same.pitch.meanKl < 1e-10);
  const changed = compareSkyChoices(baseline, [{ ...baseline[0], logits: [0, 3] }]);
  assert.equal(changed.pitch.top1Agreement, 0);
  assert.ok(changed.pitch.meanKl > 2);
  assert.throws(() => compareSkyChoices(baseline, []));
  assert.throws(() => compareSkyChoices(baseline, [{ ...baseline[0], logits: [NaN, 1] }]));
});
test('finite masked logits drive sampling and malformed predictions fail explicitly', () => {
  assert.equal(sampleSkyLogits([100, -100], 0.5), 0);
  assert.equal(sampleSkyLogits([-100, 100], 0.5), 1);
  assert.throws(() => sampleSkyLogits([Infinity, 0], 0.5));
});

test('recorded WebGPU precision comparisons recompute and generated continuations remain legal', async () => {
  const { readFileSync } = await import('node:fs');
  const { skyAccept, skyBars, SKY_MODEL } = await import('./skytnt.js');
  const reference = JSON.parse(
    readFileSync(new URL('../evaluations/skytnt/results/fp32-choices.json', import.meta.url)),
  );
  const report = JSON.parse(
    readFileSync(new URL('../evaluations/skytnt/results/webgpu-w4a16.json', import.meta.url)),
  );
  assert.equal(report.manifest.sourceRevision, SKY_MODEL.revision);
  assert.equal(report.manifest.recipe.weightBits, 4);
  assert.ok(report.manifest.recipe.fp32Islands.includes('RMSNorm'));
  assert.equal(
    report.manifest.files.base.matMulNBits + report.manifest.files.token.matMulNBits,
    106,
  );
  assert.equal(report.tensorEvidence.cacheType, 'float16');
  assert.equal(report.tensorEvidence.hiddenLocation, 'gpu-buffer');
  const before = [],
    after = [];
  for (const trial of report.precision) {
    const expected = reference.cases.find(
      (c) => c.fixture === trial.fixture && c.seed === trial.seed,
    );
    before.push(...expected.choices);
    after.push(...trial.choices);
  }
  const measured = compareSkyChoices(before, after);
  for (const group of ['all', 'pitch', 'duration']) {
    assert.equal(measured[group].top1Agreement, report.precisionSummary[group].top1Agreement);
    assert.ok(Math.abs(measured[group].meanKl - report.precisionSummary[group].meanKl) < 1e-10);
  }
  for (const trial of report.results) {
    const expected = reference.cases.find(
        (c) => c.fixture === trial.fixture && c.seed === trial.seed,
      ),
      state = structuredClone(expected.prompt);
    assert.deepEqual(
      trial.rows.map((row) => skyAccept(state, row)),
      trial.events,
    );
    assert.deepEqual(skyBars(state, trial.events), trial.bars);
    assert.equal(state.cursor, state.endTick);
    assert.ok(trial.bars.every((bar) => bar.events.reduce((sum, e) => sum + e.duration, 0) === 4));
  }
});
