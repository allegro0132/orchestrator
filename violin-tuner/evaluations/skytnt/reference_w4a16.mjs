// Teacher-forced FP32 reference: compare quantization on identical contexts and event prefixes.
import * as ort from 'onnxruntime-node';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkyDecoder } from '../../src/skyDecoder.js';
import { SKY_MODEL } from '../../src/skytnt.js';
const dir = resolve(process.argv[2] || '/tmp/arco-skytnt-eval');
const output = resolve(
  process.argv[3] || fileURLToPath(new URL('./results/fp32-choices.json', import.meta.url)),
);
process.chdir(dir);
for (const part of ['base', 'token']) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(join(dir, `model_${part}.onnx`))) hash.update(data);
  if (hash.digest('hex') !== SKY_MODEL.files[part].sha256)
    throw new Error('Incorrect source weights');
}
const options = {
  executionProviders: ['cpu'],
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  logSeverityLevel: 3,
};
const base = await ort.InferenceSession.create(join(dir, 'model_base.onnx'), options),
  token = await ort.InferenceSession.create(join(dir, 'model_token.onnx'), options);
try {
  const decoder = new SkyDecoder(ort, base, token, { dtype: 'float32', lastOutputOnly: false });
  const report = JSON.parse(readFileSync(new URL('./results/benchmark.json', import.meta.url)));
  const cases = [];
  for (const trial of report.results.filter((r) => r.mode === 'constrained')) {
    const choices = [];
    const result = await decoder.generate(trial.prompt, {
      forcedRows: trial.rows,
      onLogits: (c) => choices.push(c),
    });
    cases.push({
      fixture: trial.fixture,
      seed: trial.seed,
      prompt: trial.prompt,
      rows: trial.rows,
      choices,
    });
    console.log(
      trial.fixture,
      trial.seed,
      choices.length,
      'uncertain decisions',
      Math.round(result.totalMs),
      'ms',
    );
  }
  writeFileSync(
    output,
    JSON.stringify({ source: SKY_MODEL, runtime: ort.env.versions, cases }, null, 2) + '\n',
  );
} finally {
  await base.release();
  await token.release();
}
