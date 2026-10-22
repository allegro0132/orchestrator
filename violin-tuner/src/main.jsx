import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines,
  Mic,
  Volume2,
  ArrowUpRight,
  Check,
  SlidersHorizontal,
  Music2,
  BookOpen,
  Headphones,
  X,
  Play,
  Square,
  Sprout,
} from 'lucide-react';
import { STRINGS, PATTERNS, frequency, centsOff, noteName, detectPitch } from './pitch';
import { emptyTracking, trackPitch, ACCURACY_CENTS } from './tuning.js';
import PitchHistory from './PitchHistory.jsx';
import { findTarget, advanceTarget } from './autoTarget.js';
import { playSuccessSound } from './successSound.js';
import { LanguageProvider, useLanguage } from './i18n.jsx';
import Metronome from './Metronome.jsx';
import {
  createAudioContext,
  AUDIO_SAMPLE_RATE,
  ANALYSIS_INTERVAL_MS,
  ANALYSIS_BUFFER_SIZE,
} from './audioConfig.js';
import './style.css';
const ScorePractice = React.lazy(() => import('./ScorePractice.jsx'));
const BeginnerPractice = React.lazy(() => import('./BeginnerPractice.jsx'));
function App() {
  const { lang, setLang, t } = useLanguage();
  const [mode, setMode] = useState('open'),
    [string, setString] = useState(2),
    [pattern, setPattern] = useState(0),
    [position, setPosition] = useState(0),
    [finger, setFinger] = useState(1),
    [reference, setReference] = useState(() => Number(localStorage.getItem('arco-a')) || 440),
    [auto, setAuto] = useState(true),
    [fingerAuto, setFingerAuto] = useState(true),
    [starting, setStarting] = useState(false),
    [listening, setListening] = useState(false),
    [hz, setHz] = useState(null),
    [error, setError] = useState(''),
    [playing, setPlaying] = useState(false),
    [help, setHelp] = useState(false),
    [settings, setSettings] = useState(false);
  const [importedScore, setImportedScore] = useState(null);
  const [tracking, setTracking] = useState(() => emptyTracking());
  const tracker = useRef(emptyTracking()),
    pitchBuffer = useRef([]),
    feedbackUntil = useRef(0),
    pendingTarget = useRef(null);
  const audio = useRef(null),
    stream = useRef(null),
    frame = useRef(null),
    osc = useRef(null),
    running = useRef(false),
    config = useRef({});
  const base = STRINGS[string].midi,
    targetMidi =
      mode === 'open' || finger === 0
        ? base
        : base + [0, 2, 4, 5, 7][position] + PATTERNS[pattern].steps[finger - 1],
    target = frequency(targetMidi, reference),
    note = noteName(targetMidi),
    cents = hz ? centsOff(hz, target) : 0,
    inTune = hz && Math.abs(cents) <= ACCURACY_CENTS + 1e-6;
  const trackingKey = `${mode}:${string}:${position}:${pattern}:${finger}:${reference}`;
  config.current = {
    mode,
    auto: mode === 'open' ? auto : fingerAuto,
    reference,
    string,
    finger,
    position,
    pattern,
    target,
    key: trackingKey,
  };
  function resetTracking() {
    pendingTarget.current = null;
    tracker.current = emptyTracking(config.current.key);
    pitchBuffer.current = [];
    setTracking(tracker.current);
  }
  useEffect(() => {
    localStorage.setItem('arco-a', reference);
  }, [reference]);
  function stopTone() {
    if (osc.current) {
      try {
        osc.current.stop();
      } catch {}
      osc.current = null;
    }
    setPlaying(false);
  }
  function stop() {
    running.current = false;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setListening(false);
    setHz(null);
  }
  useEffect(
    () => () => {
      running.current = false;
      cancelAnimationFrame(frame.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    stopTone();
    setHz(null);
    resetTracking();
    if (['metronome', 'score', 'beginner'].includes(mode)) stop();
  }, [string, mode, pattern, position, finger, reference]);
  async function context() {
    if (!audio.current)
      audio.current = createAudioContext(window.AudioContext || window.webkitAudioContext);
    await audio.current.resume();
    return audio.current;
  }
  async function start() {
    if (starting) return;
    setError('');
    stopTone();
    resetTracking();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        '当前环境无法使用麦克风。请通过 HTTPS 或 localhost 打开，并使用支持麦克风的浏览器。',
      );
      return;
    }
    setStarting(true);
    try {
      const ctx = await context();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: AUDIO_SAMPLE_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (['metronome', 'score', 'beginner'].includes(config.current.mode)) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const source = ctx.createMediaStreamSource(media),
        analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSIS_BUFFER_SIZE;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      running.current = true;
      setListening(true);
      let last = 0;
      function tick(time) {
        if (!running.current) return;
        if (time - last >= ANALYSIS_INTERVAL_MS) {
          last = time - ((time - last) % ANALYSIS_INTERVAL_MS);
          analyser.getFloatTimeDomainData(buffer);
          const raw = detectPitch(buffer, ctx.sampleRate);
          let f = raw;
          const current = config.current;
          const feedbackPlaying = time < feedbackUntil.current;
          if (f) {
            pitchBuffer.current.push(f);
            if (pitchBuffer.current.length > 3) pitchBuffer.current.shift();
            f = [...pitchBuffer.current].sort((a, b) => a - b)[
              Math.floor(pitchBuffer.current.length / 2)
            ];
            if (current.auto && !feedbackPlaying) {
              const result = advanceTarget(
                pendingTarget.current,
                findTarget(f, current),
                current,
                time,
              );
              pendingTarget.current = result.pending;
              if (result.target) {
                setString(result.target.string);
                if (current.mode === 'finger') setFinger(result.target.finger);
                setHz(null);
                pitchBuffer.current = [];
                pendingTarget.current = null;
                frame.current = requestAnimationFrame(tick);
                return;
              }
            } else {
              pendingTarget.current = null;
            }
            setHz(f);
          } else {
            pitchBuffer.current = [];
            pendingTarget.current = null;
            setHz(null);
          }
          const previousSuccess = tracker.current.success;
          tracker.current = trackPitch(tracker.current, time, raw, current.target, current.key, {
            feedbackPlaying,
          });
          if (tracker.current.success && tracker.current.success.time !== previousSuccess?.time) {
            const duration = playSuccessSound(ctx);
            if (duration) {
              feedbackUntil.current = time + duration * 1000 + 180;
            }
          }
          setTracking(tracker.current);
        }
        frame.current = requestAnimationFrame(tick);
      }
      frame.current = requestAnimationFrame(tick);
    } catch (e) {
      stop();
      setError(
        e.name === 'NotAllowedError'
          ? '麦克风权限未开启。请在浏览器地址栏允许麦克风访问，然后重试。'
          : e.name === 'NotFoundError'
            ? '没有找到麦克风，请连接音频设备后重试。'
            : '麦克风暂时无法启动，请检查是否被其他应用占用后重试。',
      );
    } finally {
      setStarting(false);
    }
  }
  async function playTone() {
    if (playing) {
      stopTone();
      return;
    }
    if (listening) stop();
    try {
      const ctx = await context(),
        o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = target;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.08);
      g.gain.setValueAtTime(0.16, ctx.currentTime + 2.6);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 3);
      o.connect(g);
      g.connect(ctx.destination);
      osc.current = o;
      setPlaying(true);
      o.onended = () => {
        if (osc.current === o) {
          osc.current = null;
          setPlaying(false);
        }
      };
      o.start();
      o.stop(ctx.currentTime + 3);
    } catch {
      setError('声音播放失败，请检查浏览器音频设置。');
    }
  }
  return (
    <div className="app">
      <header>
        <a className="brand" href="#" aria-label={t('弦准首页')}>
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          <b>
            {t('弦准')}
            <span>{lang === 'en' ? 'VIOLIN' : 'ARCO'}</span>
          </b>
        </a>
        <nav>
          <button className="nav-active" onClick={() => setHelp(false)}>
            {t('调音室')}
          </button>
          <button onClick={() => setHelp(true)}>
            {t('练习指南')}
            <ArrowUpRight size={13} />
          </button>
        </nav>
        <select
          className="language-select"
          aria-label="Language / 语言"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
        <button className="settings" aria-label={t('调音设置')} onClick={() => setSettings(true)}>
          <SlidersHorizontal size={17} />
          <span>{t('调音设置')}</span>
        </button>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">
              <span /> YOUR DAILY VIOLIN COMPANION
            </div>
            <h1>
              {t(
                mode === 'beginner'
                  ? '从慢练开始，打好基础'
                  : mode === 'metronome'
                    ? '让每一拍，都稳稳落下'
                    : '从每一根弦，找到好声音',
              )}
              <span>{lang === 'zh' ? '。' : '.'}</span>
            </h1>
            <p>{t('安静地聆听，让每一次练习都从准确开始。')}</p>
          </div>
          <div className="intro-note">
            <Music2 size={24} />
            <span>
              {t('为你的小提琴')}
              <br />
              <strong>{t('留一点专注的时间')}</strong>
            </span>
          </div>
        </div>
        <div className="workspace">
          <aside>
            <div className="section-label">
              {t('练习模式')}
              <span>01 — 05</span>
            </div>
            <button
              className={'mode ' + (mode === 'open' ? 'active' : '')}
              onClick={() => setMode('open')}
            >
              <span className="mode-icon">
                <AudioLines size={21} />
              </span>
              <span>
                <b>{t('空弦调音')}</b>
                <small>{t('四根弦，回到标准音')}</small>
              </span>
              {mode === 'open' && <span className="active-dot" />}
            </button>
            <button
              className={'mode ' + (mode === 'finger' ? 'active' : '')}
              onClick={() => setMode('finger')}
            >
              <span className="mode-icon">
                <Music2 size={21} />
              </span>
              <span>
                <b>{t('手型练习')}</b>
                <small>{t('指位与音准，一起掌握')}</small>
              </span>
              {mode === 'finger' && <span className="active-dot" />}
            </button>
            <button
              className={'mode ' + (mode === 'metronome' ? 'active' : '')}
              onClick={() => setMode('metronome')}
            >
              <span className="mode-icon">
                <Play size={21} />
              </span>
              <span>
                <b>{t('节拍器')}</b>
                <small>{t('找到节奏，稳住每一拍')}</small>
              </span>
              {mode === 'metronome' && <span className="active-dot" />}
            </button>
            <button
              className={'mode beginner-mode ' + (mode === 'beginner' ? 'active' : '')}
              onClick={() => setMode('beginner')}
            >
              <span className="mode-icon">
                <Sprout size={21} />
              </span>
              <span>
                <b>{t('初学者练习')}</b>
                <small>{t('长弓、换弦与左手入门')}</small>
              </span>
              {mode === 'beginner' && <span className="active-dot" />}
            </button>
            <button
              className={'mode score-mode ' + (mode === 'score' ? 'active' : '')}
              onClick={() => setMode('score')}
            >
              <span className="mode-icon">
                <BookOpen size={21} />
              </span>
              <span>
                <b>{t('曲谱练习')}</b>
                <small>{t('跟随曲谱，听见进步')}</small>
              </span>
              {mode === 'score' && <span className="active-dot" />}
            </button>
            {!['metronome', 'score', 'beginner'].includes(mode) && (
              <>
                <div className="string-head">
                  <span>{t('选择琴弦')}</span>
                  <span>{t('低音 → 高音')}</span>
                </div>
                <div className="strings">
                  {STRINGS.map((s, i) => (
                    <button
                      key={s.name}
                      className={string === i ? 'selected' : ''}
                      onClick={() => {
                        setString(i);
                        setAuto(false);
                        setFingerAuto(false);
                      }}
                    >
                      <span>
                        {s.name}
                        <sub>{noteName(s.midi).octave}</sub>
                      </span>
                      <small>{t(s.label)}</small>
                      {string === i ? <Check size={16} /> : <span className="tiny-line" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="tip">
              <span className="tip-icon">
                <Headphones size={19} />
              </span>
              <b>{t(mode === 'metronome' ? '从慢速开始练习' : '给自己一点安静')}</b>
              <p>
                {t(
                  mode === 'metronome'
                    ? '先把速度放慢，准确完成每个节奏，再逐渐提速。'
                    : '在安静的环境中，持续拉奏一根弦，音准读数会更稳定。',
                )}
              </p>
              <div>
                {t(mode === 'metronome' ? '声音在设备本地生成' : '声音仅在设备本地分析')}
                <span>↗</span>
              </div>
            </div>
          </aside>
          {mode === 'beginner' ? (
            <React.Suspense
              fallback={
                <section className="tuner score-loading">{t('正在加载初学者练习…')}</section>
              }
            >
              <BeginnerPractice getAudioContext={context} reference={reference} />
            </React.Suspense>
          ) : mode === 'score' ? (
            <React.Suspense
              fallback={
                <section className="tuner score-loading">
                  {lang === 'zh' ? '正在加载曲谱练习…' : 'Loading score practice…'}
                </section>
              }
            >
              <ScorePractice
                getAudioContext={context}
                reference={reference}
                score={importedScore}
                setScore={setImportedScore}
              />
            </React.Suspense>
          ) : mode === 'metronome' ? (
            <Metronome getAudioContext={context} />
          ) : (
            <section className="tuner">
              <div className="panel-top">
                <span className="panel-title">
                  <span className="olive-dot" />
                  {mode === 'open' || finger === 0 ? t('空弦调音') : t('指位调音')}
                  <span className="tag">
                    {mode === 'open' ? 'OPEN STRINGS' : 'FINGER PRACTICE'}
                  </span>
                </span>
                <span className="reference">A₄ = {reference} Hz</span>
              </div>
              {mode === 'finger' && (
                <div className="finger-controls">
                  <label>
                    {t('把位')}
                    <select
                      value={position}
                      onChange={(e) => {
                        setPosition(+e.target.value);
                        setFingerAuto(true);
                      }}
                    >
                      {['第一把位', '第二把位', '第三把位', '第四把位', '第五把位'].map((p, i) => (
                        <option value={i} key={p}>
                          {t(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('手型')}
                    <select
                      value={pattern}
                      onChange={(e) => {
                        setPattern(+e.target.value);
                        setFingerAuto(true);
                      }}
                    >
                      {PATTERNS.map((p, i) => (
                        <option value={i} key={t(p.name)}>
                          {t(p.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="fingers">
                    {[1, 2, 3, 4].map((f) => (
                      <button
                        className={finger === f ? 'on' : ''}
                        aria-pressed={finger === f}
                        onClick={() => {
                          setFinger((current) => (current === f ? 0 : f));
                          setFingerAuto(false);
                        }}
                        key={f}
                      >
                        {lang === 'zh' ? `${f} 指` : `Finger ${f}`}
                      </button>
                    ))}
                  </div>
                  <p className="auto-hint">
                    {t(
                      '自动识别保持当前把位与手型，同音优先保留当前琴弦。手动选择会锁定目标，可用下方开关恢复自动。',
                    )}
                  </p>
                </div>
              )}
              <div className={'tuner-body ' + (mode === 'finger' ? 'compact' : '')}>
                <div
                  className={
                    'live-status ' + (tracking.success ? 'success' : listening ? 'live' : '')
                  }
                >
                  <span />
                  {tracking.success
                    ? t('本次调音成功 · 已稳定保持 0.5 秒')
                    : listening
                      ? hz
                        ? t('正在聆听琴声')
                        : t('等待琴声…')
                      : t('准备好，开始聆听')}
                </div>
                <div className="note-display">
                  <span>{note.name}</span>
                  <sub>{note.octave}</sub>
                </div>
                <div className="note-caption">
                  {STRINGS[string].name} {lang === 'zh' ? '弦' : 'string'} ·{' '}
                  {mode === 'open' || finger === 0
                    ? t('空弦')
                    : lang === 'zh'
                      ? `${position + 1} 把位 · ${finger} 指`
                      : `Position ${position + 1} · Finger ${finger}`}
                  <span>
                    {lang === 'zh' ? '目标' : 'Target'} {target.toFixed(2)} Hz
                  </span>
                </div>
                <div className="meter">
                  <div className="meter-labels">
                    <span>{t('偏低 ♭')}</span>
                    <span className={inTune ? 'good' : ''}>
                      {hz
                        ? inTune
                          ? t('当前接近标准音')
                          : `${cents > 0 ? '+' : ''}${Math.round(cents)} ${t('音分')}`
                        : t('让指针回到中央')}
                    </span>
                    <span>{t('偏高 ♯')}</span>
                  </div>
                  <div className="scale">
                    <div
                      className="sweet-spot"
                      style={{
                        left: `${50 - ACCURACY_CENTS * 0.9}%`,
                        width: `${ACCURACY_CENTS * 1.8}%`,
                      }}
                    />
                    {Array.from({ length: 41 }, (_, i) => (
                      <i key={i} className={i % 10 === 0 ? 'major' : i % 5 === 0 ? 'medium' : ''} />
                    ))}
                    <div
                      className={'needle ' + (inTune ? 'tuned' : '')}
                      style={{ left: `${50 + Math.max(-50, Math.min(50, cents)) * 0.9}%` }}
                    >
                      <span />
                    </div>
                  </div>
                  <div className="scale-labels">
                    <span>−50</span>
                    <span>−25</span>
                    <span>0</span>
                    <span>+25</span>
                    <span>+50</span>
                  </div>
                </div>
                <div className="reading">
                  <span className={'reading-dot ' + (inTune ? 'tuned' : '')} />
                  {hz ? (
                    <>
                      <b>
                        {hz.toFixed(1)} <small>Hz</small>
                      </b>
                      <span>
                        {inTune
                          ? t('很好，保持这个音')
                          : cents < 0
                            ? t('音偏低，请稍微升高')
                            : t('音偏高，请稍微降低')}
                      </span>
                    </>
                  ) : (
                    <span>
                      {listening ? t('缓慢、平稳地拉奏目标音') : t('开启麦克风，即可实时查看音准')}
                    </span>
                  )}
                </div>
                <button
                  className={'mic-button ' + (listening ? 'listening' : '')}
                  disabled={starting}
                  onClick={listening ? stop : start}
                >
                  {listening ? <Square size={17} /> : <Mic size={19} />}{' '}
                  {starting ? t('正在开启…') : listening ? t('停止调音') : t('开启麦克风')}{' '}
                  <span>{listening ? 'LISTENING' : 'START TUNING'}</span>
                </button>
                {error && (
                  <div className="error" role="alert">
                    {t(error)}
                  </div>
                )}
                <button className="play-tone" onClick={playTone}>
                  {playing ? <Square size={15} /> : <Volume2 size={17} />}{' '}
                  {playing ? t('停止标准音') : t('聆听标准音')}
                  <span>
                    {note.name}
                    {note.octave}
                  </span>
                </button>
                <PitchHistory tracking={tracking} listening={listening} onReset={resetTracking} />
              </div>
              <div className="panel-bottom">
                <label className="switch-label">
                  <button
                    role="switch"
                    aria-checked={mode === 'open' ? auto : fingerAuto}
                    aria-label={t(mode === 'open' ? '自动识别琴弦' : '自动识别琴弦与指位')}
                    className={'switch ' + ((mode === 'open' ? auto : fingerAuto) ? 'on' : '')}
                    onClick={() => {
                      pendingTarget.current = null;
                      mode === 'open' ? setAuto(!auto) : setFingerAuto(!fingerAuto);
                    }}
                  >
                    <span />
                  </button>
                  {t(mode === 'open' ? '自动识别琴弦' : '自动识别琴弦与指位')}
                </label>
                <span>
                  <span className="secure-dot" />
                  {t('音频不上传，安心练习')}
                </span>
              </div>
            </section>
          )}
        </div>
        {mode === 'finger' && (
          <section className="fingerboard-card">
            <div>
              <span className="eyebrow">FINGERBOARD STUDY</span>
              <h2>{t('让音准，成为手指的记忆。')}</h2>
              <p>
                {t(PATTERNS[pattern].sub)} · {t('选择指位查看目标音')}
              </p>
            </div>
            <div className="fingerboard">
              <div className="fingerboard-line" />
              {[0, ...PATTERNS[pattern].steps].map((step, i) => {
                const n = noteName(base + (i ? [0, 2, 4, 5, 7][position] + step : 0));
                return (
                  <button
                    key={i}
                    className={finger === i ? 'current' : ''}
                    aria-pressed={finger === i}
                    onClick={() => {
                      setFinger(i);
                      setFingerAuto(false);
                    }}
                  >
                    <span>{i === 0 ? t('空') : i}</span>
                    <b>
                      {n.name}
                      <sub>{n.octave}</sub>
                    </b>
                    <small>
                      {i ? `${step} ${lang === 'zh' ? '半音' : 'semitones'}` : t('空弦')}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <div className="below">
          <div className="practice-tip">
            <span className="mini-symbol">♮</span>
            <div>
              <b>{t('每一次准确，都是进步。')}</b>
              <p>
                {mode === 'beginner'
                  ? t('先练准确，再练连续。对镜观察弓直和接触点。')
                  : mode === 'score'
                    ? t('导入曲谱，选择声部和速度，跟随预备拍开始演奏。')
                    : mode === 'metronome'
                      ? t('先把速度放慢，准确完成每个节奏，再逐渐提速。')
                      : mode === 'open'
                        ? t('建议按 A → D → G → E 的顺序调弦，再复查一次。')
                        : t(
                            '相邻手指相距 1 个半音时靠拢，2 个半音时分开。各手型以当前把位为基准。',
                          )}
              </p>
            </div>
          </div>
          <button className="guide-link" onClick={() => setHelp(true)}>
            {t('第一次使用？查看调音指南')}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </main>
      <footer>
        <span>
          {lang === 'zh' ? '弦准 ARCO' : 'ARCO VIOLIN'} <i> / </i>
          {t('为每一个认真练琴的你')}
        </span>
        <span>
          {t('慢慢来，好声音值得等待。')}
          <span className="footer-lines">▂ ▄ ▆ ▃ ▅</span>
        </span>
      </footer>
      {(help || settings) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setHelp(false);
            setSettings(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={help ? t('调音指南') : t('调音设置')}
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label={t('关闭')}
              onClick={() => {
                setHelp(false);
                setSettings(false);
              }}
            >
              <X size={20} />
            </button>
            {help ? (
              <>
                <BookOpen size={28} />
                <h2>{t('开始你的调音练习')}</h2>
                <ol>
                  <li>
                    <b>{t('先调空弦')}</b>
                    <p>{t('选择琴弦并开启麦克风，允许浏览器访问。持续拉奏单弦，观察指针。')}</p>
                  </li>
                  <li>
                    <b>{t('读懂音准')}</b>
                    <p>
                      {t(
                        '指针左偏表示音低，右偏表示音高，进入中央 ±20 音分的绿色区域表示当前接近标准音。查看最近 6 秒曲线，平均偏差在 ±20 音分内，至少 80% 读数在 ±20 音分内、标准差不超过 20 音分，持续约 0.5 秒后会显示“调音成功”。短暂换弓可容忍，断音超过 0.3 秒会重新累计。成功结果在停弓后保留；断音或偏离准确区持续 0.3 秒后，下次拉奏会自动重新检测并再次提示。',
                      )}
                    </p>
                  </li>
                  <li>
                    <b>{t('练习手型')}</b>
                    <p>
                      {t(
                        '切换手型练习，选择琴弦、把位、手型和手指。对照指板按弦，可先播放标准音再练习。',
                      )}
                    </p>
                  </li>
                  <li>
                    <b>{t('节拍练习')}</b>
                    <p>
                      {t(
                        '选择节拍器模式，设置速度和拍号后开始。首拍可加重音，切换模式或隐藏页面时会自动停止。',
                      )}
                    </p>
                  </li>
                  <li>
                    <b>{t('初学者练习')}</b>
                    <p>
                      {t('选择内置练习，跟随弓向、拍数与手指提示；每一轮结束后对照检查点自检。')}
                    </p>
                  </li>
                  <li>
                    <b>{t('曲谱练习')}</b>
                    <p>{t('导入曲谱，选择声部和速度，跟随预备拍开始演奏。')}</p>
                  </li>
                </ol>
                <div className="modal-info">
                  {t(
                    '使用十二平均律；把位按自然音阶上移。手型名称描述指间关系，不代表某个调的固定指法。调弦时小幅转动微调，避免琴弦张力过大。',
                  )}
                </div>
              </>
            ) : (
              <>
                <SlidersHorizontal size={28} />
                <h2>{t('调音设置')}</h2>
                <label className="setting-label">
                  {t('标准音 A₄')}
                  <select value={reference} onChange={(e) => setReference(+e.target.value)}>
                    {Array.from({ length: 21 }, (_, i) => 430 + i).map((n) => (
                      <option key={n} value={n}>
                        {n} Hz {n === 440 ? t('（标准）') : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <p>{t('默认 440 Hz。合奏时，可根据乐团的标准音调整。')}</p>
                <div className="modal-info">
                  {t(
                    '麦克风声音只在当前设备处理，不会录制或上传。手机请使用 HTTPS 地址，并保持页面在前台。',
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>,
);
