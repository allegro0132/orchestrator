import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVibeEngineHost,
  VIBE_ENGINE_PROTOCOL,
  acceptEngineReady,
  isCurrentEngineWorker,
  engineForPrediction,
} from './vibeEngineHost.js';
import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT } from './skyWeights.js';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(overrides = {}) {
  const messages = [],
    calls = { sky: 0, rules: 0 };
  const host = createVibeEngineHost({
    post: (m) => messages.push(m),
    loadTransformer: async () => ({ generate() {} }),
    generateRules: () => {
      calls.rules++;
      return [{ bar: 1 }];
    },
    generateTransformer: async (_, request, { publish }) => {
      calls.sky++;
      publish([{ bar: 1 }]);
      return [{ bar: 1 }];
    },
    ...overrides,
  });
  return { host, messages, calls };
}
async function loadReady(host) {
  await host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  await host.handle({ type: 'verify' });
}
const predict = (id = 1, predictor = SKY_DEPLOYMENT) => ({
  type: 'predict',
  id,
  request: { predictor },
});
test('the reported undefined.generate case is rejected when a rules worker receives a SkyTNT request', async () => {
  const { host, messages, calls } = fixture();
  await host.handle({ type: 'load', engine: RULE_MODEL_ID });
  await host.handle(predict());
  assert.equal(messages[0].type, 'ready');
  assert.equal(messages[0].engine, RULE_MODEL_ID);
  assert.equal(messages.at(-1).code, 'ENGINE_MISMATCH');
  assert.equal(calls.sky, 0);
  assert.equal(calls.rules, 0);
});
test('prediction before initialization never dereferences an absent decoder', async () => {
  const { host, messages, calls } = fixture();
  await host.handle(predict());
  assert.equal(messages[0].code, 'MODEL_NOT_READY');
  assert.equal(calls.sky, 0);
});
test('Ready requires a separate Worker message to exercise a full-horizon prediction', async () => {
  const loading = deferred(),
    { host, messages, calls } = fixture({ loadTransformer: () => loading.promise });
  const pending = host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  await Promise.resolve();
  assert.equal(messages.length, 0);
  loading.resolve({ generate() {}, persistent: false });
  await pending;
  assert.deepEqual(messages, [
    { type: 'loaded', engine: SKY_DEPLOYMENT, protocol: VIBE_ENGINE_PROTOCOL },
  ]);
  await host.handle(predict());
  assert.equal(messages.at(-1).code, 'MODEL_NOT_READY');
  await host.handle({ type: 'verify' });
  assert.equal(messages.at(-1).type, 'ready');
  assert.equal(messages.at(-1).persistent, false);
  assert.equal(calls.sky, 1);
  const before = messages.length;
  await host.handle(predict());
  assert.deepEqual(
    messages.slice(before).map((m) => m.type),
    ['bars', 'result'],
  );
  assert.equal(calls.sky, 2);
  assert.ok(messages.every((m) => m.engine === SKY_DEPLOYMENT));
});
test('preflight uses the production generation callback and suppresses test score streaming', async () => {
  const model = { generate() {} };
  const { host, messages } = fixture({
    loadTransformer: () => Promise.resolve(model),
    generateTransformer: (loaded, request, { publish }) => {
      assert.equal(loaded, model);
      assert.equal(request.count, 4);
      assert.equal(request.predictor, SKY_DEPLOYMENT);
      assert.equal(request.notes.length, 2);
      publish([{ bar: 1 }]);
      return Promise.resolve([{ bar: 1 }]);
    },
  });
  await loadReady(host);
  assert.deepEqual(
    messages.map((m) => m.type),
    ['loaded', 'ready'],
  );
});
test('a failed post-load self-test never enables recording', async () => {
  const { host, messages } = fixture({
    generateTransformer: () => Promise.reject(Error('GPU kernel failed')),
  });
  await loadReady(host);
  assert.equal(messages.at(-1).code, 'MODEL_PREFLIGHT_FAILED');
  assert.equal(messages.at(-1).stage, 'verify');
  assert.ok(!messages.some((m) => m.type === 'ready'));
  await host.handle(predict());
  assert.equal(messages.at(-1).code, 'MODEL_NOT_READY');
});
test('loaded model survives separate message turns and repeated predictions', async () => {
  const model = { generate() {} };
  let predictions = 0;
  const { host, messages } = fixture({
    loadTransformer: () => Promise.resolve(model),
    generateTransformer: (loaded, request, { publish }) => {
      assert.equal(loaded, model);
      predictions++;
      publish([{ bar: predictions }]);
      return Promise.resolve([{ bar: predictions }]);
    },
  });
  await loadReady(host);
  for (let id = 1; id <= 20; id++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.handle(predict(id));
    assert.equal(messages.at(-1).type, 'result');
  }
  assert.equal(predictions, 21);
});
test('failed or incomplete mobile initialization cannot publish Ready and a retry can recover', async () => {
  let attempts = 0;
  const { host, messages } = fixture({
    loadTransformer: async () => {
      if (++attempts === 1) throw Error('GPU warmup failed');
      return { generate() {} };
    },
  });
  await host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  assert.equal(messages[0].type, 'error');
  assert.equal(messages[0].stage, 'load');
  await host.handle(predict());
  assert.equal(messages.at(-1).code, 'MODEL_NOT_READY');
  await loadReady(host);
  assert.equal(messages.at(-1).type, 'ready');
  await host.handle(predict(2));
  assert.equal(messages.at(-1).type, 'result');
  const incomplete = fixture({ loadTransformer: async () => undefined });
  await incomplete.host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  assert.equal(incomplete.messages[0].code, 'MODEL_NOT_READY');
  assert.ok(!incomplete.messages.some((m) => m.type === 'ready'));
});
test('canceling streamed inference rejects late bars while preserving the loaded model for the next request', async () => {
  const wait = deferred();
  const { host, messages } = fixture({
    generateTransformer: async (_, request, { publish, shouldCancel }) => {
      if (request.count === 4) return [{ bar: 1 }];
      await wait.promise;
      publish([{ bar: 1 }]);
      assert.equal(shouldCancel(), request.cancelExpected);
      return [{ bar: 1 }];
    },
  });
  await loadReady(host);
  const request = predict(7);
  request.request.cancelExpected = true;
  const run = host.handle(request);
  await host.handle({ type: 'cancel', id: 7 });
  wait.resolve();
  await run;
  assert.deepEqual(
    messages.map((m) => m.type),
    ['loaded', 'ready', 'canceled'],
  );
  const next = predict(8);
  next.request.cancelExpected = false;
  await host.handle(next);
  assert.equal(messages.at(-1).type, 'result');
  assert.equal(messages.at(-1).id, 8);
});
test('disposing during asynchronous load suppresses stale Ready and releases the completed model', async () => {
  const wait = deferred();
  let disposed = 0;
  const { host, messages } = fixture({ loadTransformer: () => wait.promise });
  const loading = host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  await host.dispose();
  wait.resolve({
    generate() {},
    dispose() {
      disposed++;
    },
  });
  await loading;
  assert.equal(disposed, 1);
  assert.equal(messages.length, 0);
});
test('replaced Worker messages and mismatched readiness cannot enable prediction', () => {
  const old = {},
    current = {},
    state = { worker: current, engine: SKY_DEPLOYMENT, ready: false, closed: false };
  const ready = { type: 'ready', engine: SKY_DEPLOYMENT, protocol: VIBE_ENGINE_PROTOCOL };
  assert.equal(acceptEngineReady(state, old, ready), false);
  assert.equal(acceptEngineReady(state, current, { ...ready, engine: RULE_MODEL_ID }), false);
  assert.equal(acceptEngineReady(state, current, { ...ready, protocol: 'old-version' }), false);
  assert.equal(engineForPrediction(state), null);
  assert.equal(acceptEngineReady(state, current, ready), true);
  assert.equal(engineForPrediction(state), SKY_DEPLOYMENT);
  state.closed = true;
  assert.equal(isCurrentEngineWorker(state, current), false);
  assert.equal(engineForPrediction(state), null);
});
test('the active loaded engine is used instead of an earlier recording callback selection', () => {
  const state = { worker: {}, engine: RULE_MODEL_ID, ready: true, closed: false };
  assert.equal(engineForPrediction(state), RULE_MODEL_ID);
  state.engine = SKY_DEPLOYMENT;
  state.ready = false;
  assert.equal(engineForPrediction(state), null);
});
test('automatic model loads preserve cache-only policy through the Worker host', async () => {
  const options = [];
  const { host } = fixture({
    loadTransformer: async (policy) => {
      options.push(policy);
      return { generate() {} };
    },
  });
  await host.handle({ type: 'load', engine: SKY_DEPLOYMENT, cachedOnly: true });
  await host.handle({ type: 'load', engine: SKY_DEPLOYMENT });
  assert.deepEqual(options, [{ cachedOnly: true }, { cachedOnly: false }]);
});
