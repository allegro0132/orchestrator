import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT } from './skyWeights.js';
export const VIBE_ENGINE_PROTOCOL = 'arco-vibe-engine-v2';
export class VibeEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
// The loaded engine is authoritative; UI selections alone never imply model readiness.
export function createVibeEngineHost({
  loadTransformer,
  generateRules,
  generateTransformer,
  post,
  now = () => performance.now(),
}) {
  let engine = null,
    model = null,
    active = null,
    disposed = false;
  const emit = (message) => {
    if (!disposed) post({ ...message, engine, protocol: VIBE_ENGINE_PROTOCOL });
  };
  async function handle(data) {
    if (disposed) return;
    if (data.type === 'cancel') {
      if (active?.id === data.id) active.canceled = true;
      return;
    }
    if (active) {
      emit({
        type: 'error',
        id: data.id,
        code: 'ENGINE_BUSY',
        message:
          'The prediction engine is still initializing or generating. Retry when it is ready.',
      });
      return;
    }
    const job = { id: data.id, canceled: false };
    active = job;
    try {
      if (data.type === 'load') {
        const previous = model;
        engine = null;
        model = null;
        await previous?.dispose?.();
        if (data.engine === RULE_MODEL_ID) engine = RULE_MODEL_ID;
        else if (data.engine === SKY_DEPLOYMENT) {
          const loaded = await loadTransformer();
          if (disposed) {
            await loaded?.dispose?.();
            return;
          }
          if (typeof loaded?.generate !== 'function') {
            await loaded?.dispose?.();
            throw new VibeEngineError(
              'MODEL_NOT_READY',
              'SkyTNT did not initialize. Reload the model before predicting.',
            );
          }
          model = loaded;
          engine = SKY_DEPLOYMENT;
        } else
          throw new VibeEngineError(
            'UNKNOWN_ENGINE',
            'Unknown continuation engine. Reload this page.',
          );
        emit({ type: 'ready', persistent: model?.persistent !== false });
      } else if (data.type === 'predict') {
        if (!engine || (engine === SKY_DEPLOYMENT && typeof model?.generate !== 'function'))
          throw new VibeEngineError(
            'MODEL_NOT_READY',
            'The selected model is not ready. Reload it before predicting.',
          );
        if (data.request.predictor !== engine)
          throw new VibeEngineError(
            'ENGINE_MISMATCH',
            'The prediction engine changed before this request. Reload the selected model and resume Vibe.',
          );
        const started = now();
        const publish = (bars) => {
          if (!job.canceled)
            emit({ type: 'bars', id: data.id, bars, milliseconds: now() - started });
        };
        let bars;
        if (engine === RULE_MODEL_ID) {
          bars = generateRules(data.request);
          for (const bar of bars) publish([bar]);
        } else
          bars = await generateTransformer(model, data.request, {
            shouldCancel: () => job.canceled,
            publish,
          });
        emit({
          type: job.canceled ? 'canceled' : 'result',
          id: data.id,
          bars,
          milliseconds: now() - started,
        });
      }
    } catch (error) {
      if (data.type === 'load') {
        engine = null;
        model = null;
      }
      emit({
        type: job.canceled ? 'canceled' : 'error',
        id: data.id,
        code: error.code || 'INFERENCE_FAILED',
        message: error.message || String(error),
        stack: error.stack,
        stage: data.type,
      });
    } finally {
      if (active === job) active = null;
    }
  }
  return {
    handle,
    dispose() {
      disposed = true;
      if (active) active.canceled = true;
      const loaded = model;
      model = null;
      engine = null;
      return loaded?.dispose?.();
    },
  };
}
// Also reject messages already queued by a Worker that has been terminated/replaced.
export function isCurrentEngineWorker(state, worker) {
  return state.worker === worker && !state.closed;
}
export function acceptEngineReady(state, worker, message) {
  if (
    !isCurrentEngineWorker(state, worker) ||
    message.protocol !== VIBE_ENGINE_PROTOCOL ||
    message.engine !== state.engine
  )
    return false;
  state.ready = true;
  return true;
}
export function engineForPrediction(state) {
  return state.ready &&
    !state.closed &&
    state.worker &&
    [RULE_MODEL_ID, SKY_DEPLOYMENT].includes(state.engine)
    ? state.engine
    : null;
}
