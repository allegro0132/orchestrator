import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Mic, Square, Plus, Download, Trash2, History, Eraser } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { detectPitch, frequency, centsOff, noteName } from './pitch.js';
import { AUDIO_SAMPLE_RATE, ANALYSIS_BUFFER_SIZE, nextAnalysisTime } from './audioConfig.js';
import {
  VIBE_KEYS,
  VIBE_MAX_SECONDS,
  keyName,
  newVibeSession,
  createCapture,
  capturePitch,
  captureNotes,
  quantizePerformance,
  vibeXml,
  vibeTrack,
} from './vibe.js';
import { saveVibe, listVibes, deleteVibe } from './vibeStore.js';
import {
  predictionRequest,
  commitPrediction,
  clearVibeContext,
  vibeDisplayTrack,
} from './vibePrediction.js';
import { RULE_MODEL_ID } from './vibeRules.js';
import { SKY_DEPLOYMENT, SKY_CACHE, SKY_BYTES } from './skyWeights.js';
import { readVibePreferences, writeVibePreferences, VIBE_TEMPOS } from './vibePreferences.js';
import {
  VIBE_ENGINE_PROTOCOL,
  isCurrentEngineWorker,
  acceptEngineReady,
  engineForPrediction,
} from './vibeEngineHost.js';
import useViolinPlayback from './useViolinPlayback.js';
import ViolinPlaybackControls from './ViolinPlaybackControls.jsx';
import ScoreNotation from './ScoreNotation.jsx';
import ScoreHUD from './ScoreHUD.jsx';
const generatedEvents = (session) => session.bars.flatMap((bar) => bar.events);
const nameOf = (midi) => {
  const note = noteName(midi);
  return `${note.name}${note.octave}`;
};

export default function VibePractice({ getAudioContext, reference, draft, onDraft }) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [preferences, setPreferences] = useState(readVibePreferences);
  const [preferencesError, setPreferencesError] = useState(false);
  function remember(patch) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    setPreferencesError(!writeVibePreferences(next));
  }
  const data = useRef(null);
  if (!data.current) data.current = draft || newVibeSession(preferences.bpm, preferences.key);
  const capture = useRef(null);
  if (!capture.current) capture.current = createCapture(data.current.notes);
  const run = useRef({ token: 0 });
  const mounted = useRef(true);
  const predictor = useRef({ worker: null, ready: false, pending: null, serial: 0 });
  const [modelStatus, setModelStatus] = useState('ready');
  const [engine, setEngine] = useState(preferences.engine);
  const [modelEnabled, setModelEnabled] = useState(false);
  const [progress, setProgress] = useState(null);
  const [modelError, setModelError] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [modelLatency, setModelLatency] = useState(null);
  const [modelAttempt, setModelAttempt] = useState(0);
  const latest = useRef({ reference, getAudioContext, onDraft });
  latest.current = { reference, getAudioContext, onDraft };
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false);
  const [time, setTime] = useState(data.current.elapsed),
    [hz, setHz] = useState(null);
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [history, setHistory] = useState([]),
    [showHistory, setShowHistory] = useState(false),
    [showCapture, setShowCapture] = useState(false);
  const [, redraw] = useState(0);
  const makeTrack = vibeDisplayTrack;
  const [contextNotice, setContextNotice] = useState(false);
  function resetContext() {
    clearVibeContext(data.current);
    const state = predictor.current;
    if (state.pending) state.worker?.postMessage({ type: 'cancel', id: state.pending.id });
    setContextNotice(true);
    void persist();
    redraw((n) => n + 1);
  }
  const [liveTrack, setTrack] = useState(() => makeTrack(data.current));
  const session = data.current;
  const tuningReference = session.reference || reference;
  const [auditionMode, setAuditionMode] = useState(false);
  const preview = useViolinPlayback(getAudioContext);
  const playbackPlan = useMemo(() => {
    if (!session.bars.length) return null;
    const start = session.bars[0].bar * 4;
    const events = generatedEvents(session).map((e) => ({ ...e, beat: e.beat - start }));
    return {
      track: liveTrack,
      windowBeat: start,
      events: events.map((e) => ({
        ...e,
        start: (e.beat * 60) / session.bpm,
        end: ((e.beat + e.duration) * 60) / session.bpm,
      })),
      duration: ((session.bars.at(-1).bar * 4 + 4 - start) * 60) / session.bpm,
    };
  }, [liveTrack, session.id]);
  const track = auditionMode && playbackPlan ? playbackPlan.track : liveTrack;
  function stopPreview() {
    preview.stop();
    setAuditionMode(false);
  }
  function listen(seekBeat = null) {
    if (recording || busy || !playbackPlan) return;
    if (preview.loading) {
      stopPreview();
      return;
    }
    const at =
      seekBeat !== null
        ? Math.max(0, ((seekBeat - playbackPlan.windowBeat) * 60) / session.bpm)
        : preview.status === 'paused'
          ? preview.time
          : 0;
    setAuditionMode(true);
    void preview.play(playbackPlan.events, playbackPlan.duration, tuningReference, at);
  }
  function snapshot(final = false) {
    const current = data.current;
    current.notes = captureNotes(capture.current, current.elapsed, final);
    return structuredClone(current);
  }
  async function persist(value = snapshot()) {
    latest.current.onDraft?.(value);
    if (!value.notes.length) return true;
    try {
      await saveVibe(value);
      if (mounted.current && value.id === data.current.id) {
        setSaved(true);
        setHistory(await listVibes());
      }
      return true;
    } catch {
      if (mounted.current && value.id === data.current.id)
        setError(
          text(
            '本地保存失败。请下载 JSON 备份，避免丢失记录。',
            'Local saving failed. Download a JSON backup to keep this take.',
          ),
        );
      return false;
    }
  }
  function stop(update = true) {
    const current = run.current;
    current.token++;
    // Let an in-flight worker finish; token checks discard its result after pausing.
    cancelAnimationFrame(current.frame);
    current.stream?.getTracks().forEach((track) => track.stop());
    current.source?.disconnect();
    current.analyser?.disconnect();
    current.stream = null;
    const value = snapshot(true);
    void persist(value);
    if (update && mounted.current) {
      setRecording(false);
      setBusy(false);
      setHz(null);
      setTime(value.elapsed);
      redraw((n) => n + 1);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const previousAnchor = document.body.style.overflowAnchor;
    document.body.style.overflowAnchor = 'none';
    listVibes()
      .then((records) => {
        if (mounted.current) setHistory(records);
      })
      .catch(() => {
        if (mounted.current)
          setError(
            text(
              '浏览器暂时无法读取本地记录，仍可录入并下载。',
              'Local history is unavailable. You can still play and download this take.',
            ),
          );
      });
    const hide = () => {
      if (document.hidden) stop();
    };
    const leave = () => stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      document.body.style.overflowAnchor = previousAnchor;
      stop(false);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    };
  }, []);
  useEffect(() => {
    const state = predictor.current;
    state.ready = false;
    state.closed = false;
    state.engine = engine;
    state.worker = null;
    setModelLatency(null);
    setModelError('');
    setProgress(null);
    if (engine !== RULE_MODEL_ID && !modelEnabled) {
      setModelStatus('idle');
      return;
    }
    setModelStatus('loading');
    let worker;
    let loadingTimer;
    const watchdog = () => {
      clearTimeout(loadingTimer);
      loadingTimer = setTimeout(
        () => fail({ message: 'Model loading timed out. Retry to resume verified shards.' }),
        90000,
      );
    };
    watchdog();
    const fail = (error) => {
      if (state.closed || (worker && state.worker !== worker)) return;
      setModelError(
        (error?.code ? `[${error.code}] ` : '') +
          (error?.message || 'Prediction failed. Retry or choose rule-based continuation.'),
      );
      clearTimeout(loadingTimer);
      clearTimeout(state.timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      state.worker = null;
      state.ready = false;
      state.pending = null;
      setModelStatus('error');
    };
    state.fail = fail;
    try {
      worker = new Worker(new URL('./vibeEngine.worker.js', import.meta.url), {
        type: 'module',
      });
      state.worker = worker;
      worker.onmessage = ({ data: result }) => {
        if (!isCurrentEngineWorker(state, worker)) return;
        if (result.protocol !== VIBE_ENGINE_PROTOCOL) {
          fail({
            code: 'OUTDATED_WORKER',
            message: 'The prediction worker is outdated. Refresh this page and reload the model.',
          });
          return;
        }
        if (result.type === 'progress' || result.type === 'initializing') {
          watchdog();
          setProgress(result);
          return;
        }
        if (result.type === 'loaded') {
          if (result.engine !== state.engine || engine !== SKY_DEPLOYMENT) {
            fail({
              code: 'ENGINE_MISMATCH',
              message: 'The loaded model changed. Reload the selected engine.',
            });
            return;
          }
          watchdog();
          setProgress({ type: 'initializing', stage: 'warmup' });
          worker.postMessage({ type: 'verify' });
          return;
        }
        if (result.type === 'ready') {
          if (!acceptEngineReady(state, worker, result)) {
            fail({
              code: 'ENGINE_MISMATCH',
              message: 'The loaded engine does not match your selection. Reload the model.',
            });
            return;
          }
          setPersistent(result.persistent !== false);
          clearTimeout(loadingTimer);
          state.ready = true;
          setModelStatus('ready');
          return;
        }
        if (result.type === 'error') {
          fail(result);
          return;
        }
        const pending = state.pending;
        if (
          !pending ||
          pending.id !== result.id ||
          !['bars', 'result', 'canceled'].includes(result.type)
        )
          return;
        if (result.type !== 'bars') {
          state.pending = null;
          clearTimeout(state.timer);
        }
        if (
          result.type === 'canceled' ||
          pending.session !== data.current.id ||
          pending.token !== run.current.token ||
          (pending.request.contextEpoch || 0) !== (data.current.contextEpoch || 0)
        )
          return;
        if (result.engine !== state.engine) {
          fail({
            code: 'ENGINE_MISMATCH',
            message: 'The prediction came from a different engine. Reload the model.',
          });
          return;
        }
        if (result.type === 'bars') {
          clearTimeout(state.timer);
          state.timer = setTimeout(() => state.fail(), 10000);
        }
        const current = data.current;
        if (
          commitPrediction(
            current,
            pending.request,
            result.bars,
            (current.elapsed * current.bpm) / 60,
            result.milliseconds,
          )
        ) {
          setTrack(makeTrack(current));
          setContextNotice(false);
          void persist();
        }
        if (result.type === 'result') setModelLatency(Math.round(result.milliseconds));
      };
      worker.onerror = fail;
      worker.postMessage({ type: 'load', engine });
    } catch {
      fail();
    }
    return () => {
      clearTimeout(loadingTimer);
      clearTimeout(state.timer);
      state.closed = true;
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      state.worker = null;
      state.ready = false;
      state.pending = null;
    };
  }, [modelAttempt, engine, modelEnabled]);
  function predict(notes, beat, token) {
    const state = predictor.current;
    const loadedEngine = engineForPrediction(state);
    if (!loadedEngine || state.pending) return;
    const request = predictionRequest(data.current, notes, beat, loadedEngine);
    if (!request) return;
    const id = ++state.serial;
    state.pending = { id, request, session: data.current.id, token };
    state.timer = setTimeout(() => state.fail(), 10000);
    state.worker.postMessage({ type: 'predict', id, request });
  }
  async function start() {
    if (!predictor.current.ready || busy || recording || data.current.elapsed >= VIBE_MAX_SECONDS)
      return;
    stopPreview();
    setBusy(true);
    setError('');
    setSaved(false);
    const token = ++run.current.token;
    try {
      const ctx = await latest.current.getAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: AUDIO_SAMPLE_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mounted.current || token !== run.current.token) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      data.current.engine = engine;
      run.current.stream = stream;
      if (!data.current.notes.length) data.current.reference = latest.current.reference;
      const source = ctx.createMediaStreamSource(stream),
        analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSIS_BUFFER_SIZE;
      source.connect(analyser);
      Object.assign(run.current, { stream, source, analyser });
      const buffer = new Float32Array(analyser.fftSize),
        origin = ctx.currentTime - data.current.elapsed;
      let lastAnalysis = -Infinity,
        lastPaint = -Infinity,
        lastSave = data.current.elapsed;
      setRecording(true);
      setBusy(false);
      const tick = (stamp) => {
        if (token !== run.current.token) return;
        const elapsed = Math.min(VIBE_MAX_SECONDS, ctx.currentTime - origin);
        const analysisTime = nextAnalysisTime(lastAnalysis, stamp);
        if (analysisTime !== null) {
          lastAnalysis = analysisTime;
          data.current.elapsed = elapsed;
          analyser.getFloatTimeDomainData(buffer);
          const detected = detectPitch(buffer, ctx.sampleRate);
          capturePitch(capture.current, elapsed, detected, data.current.reference);
          const notes = captureNotes(capture.current, elapsed);
          predict(notes, (elapsed * data.current.bpm) / 60, token);
          data.current.notes = notes;
          if (stamp - lastPaint >= 100) {
            setTime(elapsed);
            setHz(detected);
            lastPaint = stamp;
          }
          if (elapsed - lastSave >= 8) {
            lastSave = elapsed;
            void persist();
          }
          if (elapsed >= VIBE_MAX_SECONDS) {
            stop();
            return;
          }
        }
        run.current.frame = requestAnimationFrame(tick);
      };
      run.current.frame = requestAnimationFrame(tick);
    } catch {
      if (mounted.current && token === run.current.token) {
        stop();
        setError(
          text(
            '无法开启麦克风。请检查权限并使用 HTTPS 或 localhost。',
            'Microphone unavailable. Check permissions and use HTTPS or localhost.',
          ),
        );
      }
    }
  }
  async function fresh() {
    if (recording || busy) return;
    stopPreview();
    if (!(await persist())) return;
    setContextNotice(false);
    data.current = newVibeSession(preferences.bpm, preferences.key);
    capture.current = createCapture();
    latest.current.onDraft?.(structuredClone(data.current));
    setTime(0);
    setTrack(null);
    setSaved(false);
    setShowCapture(false);
    setError('');
    redraw((n) => n + 1);
  }
  function load(record) {
    if (recording || busy) return;
    stopPreview();
    setContextNotice(false);
    data.current = structuredClone(record);
    capture.current = createCapture(record.notes);
    latest.current.onDraft?.(structuredClone(record));
    setTrack(makeTrack(record));
    setTime(record.elapsed);
    setSaved(true);
    setShowHistory(false);
    setShowCapture(false);
    setError('');
    redraw((n) => n + 1);
  }
  async function remove(record) {
    stopPreview();
    try {
      await deleteVibe(record.id);
      setHistory(await listVibes());
      if (data.current.id === record.id) {
        data.current = newVibeSession(preferences.bpm, preferences.key);
        capture.current = createCapture();
        latest.current.onDraft?.(structuredClone(data.current));
        setTrack(null);
        setTime(0);
        setSaved(false);
        redraw((n) => n + 1);
      }
    } catch {
      setError(text('删除失败，请重试。', 'Could not delete the take. Try again.'));
    }
  }
  function download(kind) {
    const take = snapshot();
    const content =
      kind === 'json'
        ? JSON.stringify(take, null, 2)
        : vibeXml(
            kind === 'played' ? quantizePerformance(take.notes, take.bpm) : generatedEvents(take),
            take.bpm,
            kind === 'played' ? 'Performed melody' : 'Generated continuation',
            take.estimatedKey || 'D',
            kind === 'played' ? (take.elapsed * take.bpm) / 60 : 0,
          );
    const url = URL.createObjectURL(
      new Blob([content], {
        type: kind === 'json' ? 'application/json' : 'application/vnd.recordare.musicxml+xml',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `arco-vibe-${take.created.slice(0, 10)}-${kind}.${kind === 'json' ? 'json' : 'musicxml'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const beat =
    auditionMode && playbackPlan
      ? playbackPlan.windowBeat + (preview.time * session.bpm) / 60
      : (time * session.bpm) / 60;
  const events = useMemo(
    () =>
      track
        ? generatedEvents(session).map((event, index) => ({
            ...event,
            index,
            bar: Math.floor(event.beat / 4) + 1,
          }))
        : [],
    [track],
  );
  const event = events.find((event) => beat >= event.beat && beat < event.beat + event.duration);
  const next = events.filter((event) => event.beat > beat).slice(0, 3);
  const deviation =
    hz && event?.midi != null ? centsOff(hz, frequency(event.midi, tuningReference)) : null;
  const observed = capture.current.active?.midi;
  const capturedTrack = useMemo(
    () =>
      showCapture && !recording && session.notes.length
        ? vibeTrack(
            quantizePerformance(session.notes, session.bpm),
            session.bpm,
            'Performed melody',
            session.estimatedKey || 'D',
            (session.elapsed * session.bpm) / 60,
          )
        : null,
    [showCapture, recording, session.id, session.notes],
  );
  const transport = (
    <div className="score-actions">
      <button
        className={'mic-button' + (recording ? ' listening' : '')}
        disabled={
          busy || (!recording && modelStatus !== 'ready') || session.elapsed >= VIBE_MAX_SECONDS
        }
        onClick={recording ? () => stop() : start}
      >
        {recording ? <Square size={16} /> : <Mic size={16} />}{' '}
        {busy
          ? text('正在开启…', 'Starting…')
          : recording
            ? text('暂停并保存', 'Pause & save')
            : session.elapsed
              ? text('继续 Vibe', 'Resume Vibe')
              : text('开始 Vibe', 'Start Vibe')}
      </button>
      {playbackPlan && (
        <ViolinPlaybackControls
          player={preview}
          disabled={recording || busy}
          label={text('试听续句', 'Listen to continuation')}
          onPlay={() => listen()}
          onStop={stopPreview}
        />
      )}
    </div>
  );
  const locked = busy || recording || !!session.notes.length || !!session.bars.length;
  return (
    <section className="tuner vibe-practice" aria-label={text('Vibe 模式', 'Vibe mode')}>
      <div className="panel-top">
        <span className="panel-title">
          <span className="olive-dot" />
          Vibe<span className="tag">LIVE CONTINUATION</span>
        </span>
        <span className="reference">A₄ = {tuningReference} Hz</span>
      </div>
      <div className="score-body">
        <div className="score-heading">
          <div>
            <h2>{text('让旋律，继续生长', 'Let your melody grow')}</h2>
            <p>
              {text(
                '拉出你的旋律，前方的乐句随你生长。实际演奏与生成曲谱分开记录。',
                'Play your own melody. New phrases grow ahead of you, with your performance and suggestions recorded separately.',
              )}
            </p>
          </div>
          <div className="vibe-take-actions">
            <button className="secondary-button" onClick={resetContext} disabled={busy}>
              <Eraser size={15} />
              {text('清空续写上下文', 'Clear continuation context')}
            </button>
            <button className="secondary-button" onClick={fresh} disabled={recording || busy}>
              <Plus size={15} />
              {text('新的一段', 'New take')}
            </button>
          </div>
        </div>
        {contextNotice && (
          <p className="vibe-context-notice" role="status">
            {text(
              '续写上下文已清空。请拉一段新旋律；已有谱面和演奏记录会保留。',
              'Continuation context cleared. Play a fresh phrase; your score and performance record are preserved.',
            )}
          </p>
        )}
        <div className="score-controls">
          <label>
            {text('续写引擎', 'Continuation engine')}
            <select
              aria-label={text('续写引擎', 'Continuation engine')}
              value={engine}
              disabled={busy || recording}
              onChange={(e) => {
                setEngine(e.target.value);
                remember({ engine: e.target.value });
                setModelEnabled(false);
                data.current.lastGeneratedBar = -1;
                data.current.engine = e.target.value;
              }}
            >
              <option value={RULE_MODEL_ID}>
                {text('规律式续写（默认）', 'Rule-based (default)')}
              </option>
              <option value={SKY_DEPLOYMENT}>Transformer · SkyTNT W4A16</option>
            </select>
          </label>
          <label>
            {text('节拍速度', 'Tempo')}
            <select
              aria-label={text('Vibe 速度', 'Vibe tempo')}
              value={session.bpm}
              disabled={locked}
              onChange={(e) => {
                session.bpm = +e.target.value;
                remember({ bpm: session.bpm });
                redraw((n) => n + 1);
              }}
            >
              {VIBE_TEMPOS.map((bpm) => (
                <option value={bpm} key={bpm}>
                  {bpm} BPM
                </option>
              ))}
            </select>
          </label>
          <label>
            {text('调性', 'Key')}
            <select
              aria-label={text('Vibe 调性', 'Vibe key')}
              value={session.key}
              disabled={locked}
              onChange={(e) => {
                session.key = e.target.value;
                remember({ key: session.key });
                redraw((n) => n + 1);
              }}
            >
              <option value="auto">{text('自动估计', 'Estimate from playing')}</option>
              {VIBE_KEYS.map((key) => (
                <option key={key.id} value={key.id}>
                  {keyName(key)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="score-method" role={preferencesError ? 'status' : undefined}>
          {preferencesError
            ? text(
                '此浏览器暂时无法保存默认配置，当前选择仍然有效。',
                'This browser could not save your defaults. Your current choices still apply.',
              )
            : text(
                '引擎、速度与调性会作为新演奏的默认配置保存在此浏览器。',
                'Engine, tempo and key are remembered as defaults for new takes in this browser.',
              )}
        </p>
        <div className={'vibe-status' + (recording ? ' live' : '')} role="status" aria-live="off">
          <AudioLines size={18} />
          <div>
            <strong>
              {recording
                ? track
                  ? text('正在聆听并续写', 'Listening & extending')
                  : text('先拉一小段旋律', 'Play a short opening')
                : text('随时准备接住你的旋律', 'Ready for your next phrase')}
            </strong>
            <span>
              {text(
                '4/4 拍 · 前方 4 小节 · 每段最多 10 分钟',
                '4/4 · four bars ahead · up to 10 minutes per take',
              )}
            </span>
          </div>
          <b>
            {Math.floor(time / 60)}:{String(Math.floor(time % 60)).padStart(2, '0')}
          </b>
          {recording && (
            <button
              className="vibe-stop"
              onClick={() => stop()}
              aria-label={text('暂停 Vibe', 'Pause Vibe')}
            >
              <Square size={16} />
            </button>
          )}
        </div>
        <div className="vibe-model-status" role="status">
          <div>
            <strong>
              {engine === RULE_MODEL_ID
                ? text('规律式续写', 'Rule-based continuation')
                : 'SkyTNT · INT4 / FP16 · WebGPU'}
            </strong>
            <p>
              {modelStatus === 'ready'
                ? text('已就绪', 'Ready')
                : modelStatus === 'idle'
                  ? text(
                      '按需下载 144.5 MB 权重；需要支持 FP16 的 WebGPU。',
                      'Download 144.5 MB of weights on demand. Requires WebGPU with FP16.',
                    )
                  : modelStatus === 'error'
                    ? text(
                        '模型不可用，请重试或选择规律式续写。',
                        'Model unavailable. Retry or choose rule-based continuation.',
                      )
                    : progress?.type === 'initializing'
                      ? progress.stage === 'warmup'
                        ? text('正在验证本机模型推理…', 'Verifying model inference on this device…')
                        : text(
                            '权重校验完成，正在初始化 GPU…',
                            'Weights verified. Initializing GPU…',
                          )
                      : text('正在下载并校验权重…', 'Downloading and verifying weights…')}
              {modelStatus === 'ready' && modelLatency !== null && ` · ${modelLatency} ms`}
            </p>
            {engine !== RULE_MODEL_ID && progress?.total && modelStatus === 'loading' && (
              <>
                <progress
                  aria-label={text('权重下载进度', 'Weight download progress')}
                  value={progress.loaded}
                  max={SKY_BYTES}
                />
                <span> {(progress.loaded / 1e6).toFixed(1)} / 144.5 MB</span>
              </>
            )}
            {modelError && <p className="error">{modelError}</p>}
            {engine !== RULE_MODEL_ID && (
              <small>
                {text(
                  '已校验分片缓存在此浏览器，取消后可续传。',
                  'Verified shards are cached in this browser; canceled downloads can resume.',
                )}
                {!persistent &&
                  text(
                    ' 本地缓存不可用，下次需要重新下载。',
                    ' Persistent cache unavailable; another download may be needed next time.',
                  )}
              </small>
            )}
          </div>
          {engine !== RULE_MODEL_ID && (
            <div className="vibe-model-actions">
              {['idle', 'error'].includes(modelStatus) && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    if (recording) stop();
                    setModelEnabled(true);
                    setModelAttempt((n) => n + 1);
                  }}
                >
                  <Download size={14} />
                  {text('下载 / 加载模型', 'Download / load model')}
                </button>
              )}
              {modelStatus === 'loading' && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setModelEnabled(false);
                    setModelAttempt((n) => n + 1);
                  }}
                >
                  {text('取消', 'Cancel')}
                </button>
              )}
              {modelStatus !== 'loading' && (
                <button
                  className="secondary-button"
                  disabled={recording || busy}
                  onClick={async () => {
                    setModelEnabled(false);
                    setModelAttempt((n) => n + 1);
                    try {
                      await caches.delete(SKY_CACHE);
                      setModelError('');
                    } catch {
                      setModelError(text('无法清除缓存', 'Could not clear cached weights'));
                    }
                  }}
                >
                  <Trash2 size={14} />
                  {text('清除权重缓存', 'Clear weight cache')}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="vibe-metrics">
          <span>
            {text('已识别', 'Captured')} <b>{session.notes.length}</b> {text('个音符', 'notes')}
          </span>
          <span>
            {text('正在拉', 'Playing')} <b>{observed != null ? nameOf(observed) : '—'}</b>
          </span>
          <span>
            {text('调性估计', 'Key estimate')}{' '}
            <b>
              {session.estimatedKey
                ? keyName(VIBE_KEYS.find((k) => k.id === session.estimatedKey))
                : '—'}
            </b>
          </span>
          <span className="vibe-beats" aria-label={text('当前拍', 'Current beat')}>
            {[0, 1, 2, 3].map((n) => (
              <i key={n} className={recording && Math.floor(beat) % 4 === n ? 'active' : ''}>
                {n + 1}
              </i>
            ))}
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {track ? (
          <>
            <div className="score-view-heading">
              <span>{text('为你生成的续句', 'YOUR CONTINUATION')}</span>
              <span>
                {auditionMode
                  ? text('试听 · 小节', 'Listening · bars')
                  : text('持续续写 · 小节', 'Continuous score · bars')}{' '}
                {track.windowBeat / 4 + 1}–{track.windowBeat / 4 + track.measures.length}
              </span>
            </div>
            <ScoreNotation
              track={track}
              measureNumber={Math.min(Math.floor(beat / 4) + 1, session.bars.at(-1).bar + 1)}
              totalMeasures={session.bars.at(-1).bar + 1}
              measure={Math.min(
                track.measures.length - 1,
                Math.max(0, Math.floor((beat - track.windowBeat) / 4)),
              )}
              beat={beat - track.windowBeat}
              onSeek={!recording && !busy ? (beat) => listen(beat + track.windowBeat) : undefined}
              playing={recording || preview.playing}
              noteDuration={((event?.duration || 1) * 60) / session.bpm}
              action={
                <div className="vibe-cue">
                  {auditionMode
                    ? text(
                        '正在试听生成的续句，演奏记录保持不变。',
                        'Listening to your generated continuation. Your performance record stays unchanged.',
                      )
                    : event
                      ? text(
                          '跟随续句，也可以继续即兴。',
                          'Follow the suggestion, or keep improvising.',
                        )
                      : text(
                          '先自由演奏，续句将在下一小节接入。',
                          'Keep playing freely. Your continuation begins at the next bar.',
                        )}
                  <span>
                    {text(
                      '已有小节保持不变，新乐句逐小节追加。',
                      'Existing bars stay fixed. New phrases append one bar at a time.',
                    )}
                  </span>
                </div>
              }
              renderOverlay={({ expanded }) => (
                <ScoreHUD
                  event={event}
                  next={next}
                  reference={tuningReference}
                  counting={false}
                  done={auditionMode ? preview.status === 'ended' : time >= VIBE_MAX_SECONDS}
                  hz={hz}
                  deviation={deviation}
                  onset={null}
                  transport={transport}
                  time={auditionMode ? preview.time : time}
                  duration={auditionMode ? playbackPlan.duration : VIBE_MAX_SECONDS}
                  error={expanded ? error : ''}
                />
              )}
            />
          </>
        ) : (
          <div className="vibe-empty">
            <AudioLines size={38} />
            <h3>{text('从你的第一个音开始', 'Start with a note of your own')}</h3>
            <p>
              {text(
                '拉两个稳定的音，或保持一个长音约两拍。识别后，前方乐谱会持续生成。',
                'Play two steady notes, or hold one for about two beats. Once recognized, your score will keep growing ahead.',
              )}
            </p>
            {transport}
          </div>
        )}
        <div className="vibe-record-toolbar">
          <span>
            {recording
              ? text('演奏记录每 8 秒自动保存', 'Performance autosaves every 8 seconds')
              : saved
                ? text('已保存在此浏览器', 'Saved in this browser')
                : text(
                    '实际音符、节奏与生成版本均在本地记录',
                    'Notes, timing and generated revisions stay on this device',
                  )}
          </span>
          <button className="secondary-button" onClick={() => setShowHistory((v) => !v)}>
            <History size={14} />
            {text('演奏记录', 'Takes')} ({history.length})
          </button>
        </div>
        <div className="vibe-downloads">
          <button
            className="secondary-button"
            disabled={!session.notes.length}
            onClick={() => download('played')}
          >
            <Download size={14} />
            {text('实际演奏 MusicXML', 'Performed MusicXML')}
          </button>
          <button
            className="secondary-button"
            disabled={!session.bars.length}
            onClick={() => download('generated')}
          >
            <Download size={14} />
            {text('生成曲谱 MusicXML', 'Generated MusicXML')}
          </button>
          <button
            className="secondary-button"
            disabled={!session.notes.length}
            onClick={() => download('json')}
          >
            <Download size={14} />
            {text('完整 JSON 记录', 'Full JSON record')}
          </button>
        </div>
        {!recording && session.notes.length > 0 && (
          <details
            className="vibe-captured"
            open={showCapture}
            onToggle={(e) => setShowCapture(e.currentTarget.open)}
          >
            <summary>
              {text('查看实际拉出的曲谱（量化）', 'View your performed score (quantized)')}
            </summary>
            {showCapture && capturedTrack && (
              <ScoreNotation track={capturedTrack} measure={0} playing={false} />
            )}
          </details>
        )}
        {showHistory && (
          <div className="vibe-history">
            {!history.length ? (
              <p>
                {text(
                  '暂停第一段演奏后，这里会出现记录。',
                  'Your takes will appear here after you pause your first performance.',
                )}
              </p>
            ) : (
              history.map((record) => (
                <div className="vibe-take" key={record.id}>
                  <button disabled={recording || busy} onClick={() => load(record)}>
                    <strong>
                      {new Date(record.created).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                    </strong>
                    <small>
                      {record.notes.length} {text('音符', 'notes')} · {record.bpm} BPM ·{' '}
                      {Math.round(record.elapsed)} s
                    </small>
                  </button>
                  <button
                    className="vibe-delete"
                    aria-label={text('删除这段记录', 'Delete this take')}
                    disabled={recording || busy}
                    onClick={() => remove(record)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        <p className="score-method">
          {text(
            '默认规律式续写复用你的旋律走向和节奏；可选 SkyTNT Transformer，以实际音符和已生成的末尾小节为上下文。权重按需下载到此设备，音频不上传。生成限制为单声部、G3–B5、4/4 拍和指定小节长度。JSON 保留每次生成的引擎和版本。录入量化至八分音符，可能漏掉同音连奏及快速音符。',
            'Rule-based continuation adapts your melodic contour and rhythm by default. Optional SkyTNT Transformer uses captured notes and the generated tail as context. Weights download to this device; audio is never uploaded. Output is constrained to monophonic G3–B5, 4/4 and the requested bar count. JSON records each prediction engine and version. Eighth-note quantization may miss repeated legato and fast notes.',
          )}
        </p>
      </div>
    </section>
  );
}
