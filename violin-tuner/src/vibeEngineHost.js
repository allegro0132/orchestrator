import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT } from './skyWeights.js';
export const VIBE_ENGINE_PROTOCOL = 'arco-vibe-engine-v3';
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
    disposed = false,
    verified = false;
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
        verified = false;
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
        verified = engine === RULE_MODEL_ID;
        emit(verified ? { type: 'ready', persistent: true } : { type: 'loaded' });
      } else if (data.type === 'predict' || data.type === 'verify') {
        if (!engine || (engine === SKY_DEPLOYMENT && typeof model?.generate !== 'function'))
          throw new VibeEngineError(
            'MODEL_NOT_READY',
            'The selected model is not ready. Reload it before predicting.',
          );
        const verifying = data.type === 'verify';
        if (!verifying && !verified)
          throw new VibeEngineError(
            'MODEL_NOT_READY',
            'The model has not passed cross-message inference verification. Reload it before predicting.',
          );
        if (verifying && (engine !== SKY_DEPLOYMENT || verified))
          throw new VibeEngineError(
            'ENGINE_MISMATCH',
            'Unexpected model verification request. Reload the selected engine.',
          );
        const request = verifying
          ? {
              predictor: SKY_DEPLOYMENT,
              notes: [
                { midi: 62, start: 0, duration: 0.5 },
                { midi: 64, start: 0.5, duration: 0.5 },
              ],
              bpm: 120,
              count: 4,
              fromBar: 1,
              seed: 17,
            }
          : data.request;
        if (request.predictor !== engine)
          throw new VibeEngineError(
            'ENGINE_MISMATCH',
            'The prediction engine changed before this request. Reload the selected model and resume Vibe.',
          );
        const started = now();
        const publish = (bars) => {
          if (!job.canceled && !verifying)
            emit({ type: 'bars', id: data.id, bars, milliseconds: now() - started });
        };
        let bars;
        if (engine === RULE_MODEL_ID) {
          bars = generateRules(request);
          for (const bar of bars) publish([bar]);
        } else
          bars = await generateTransformer(model, request, {
            shouldCancel: () => job.canceled,
            publish,
          });
        if (verifying) {
          if (!bars?.length || job.canceled)
            throw new Error('The inference self-test produced no score.');
          verified = true;
          emit({ type: 'ready', persistent: model.persistent !== false });
          return;
        }
        emit({
          type: job.canceled ? 'canceled' : 'result',
          id: data.id,
          bars,
          milliseconds: now() - started,
        });
      }
    } catch (error) {
      if (data.type === 'verify') verified = false;
      if (data.type === 'load') {
        engine = null;
        model = null;
      }
      emit({
        type: job.canceled ? 'canceled' : 'error',
        id: data.id,
        code: data.type === 'verify' ? 'MODEL_PREFLIGHT_FAILED' : error.code || 'INFERENCE_FAILED',
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
      verified = false;
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
