import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Play, Square, RotateCcw, Music2 } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import {
  importScore,
  parseMusicXml,
  DEMO_XML,
  timedEvents,
  secondsAt,
  scoreStartAtBeat,
} from './score.js';
import { createScoreAnalysis, analyseScore, currentEvent, scoreSummary } from './scoreAnalysis.js';
import { detectPitch, frequency, centsOff } from './pitch.js';
import { AUDIO_SAMPLE_RATE, ANALYSIS_BUFFER_SIZE, nextAnalysisTime } from './audioConfig.js';
import ScoreNotation from './ScoreNotation.jsx';
import ScoreHUD from './ScoreHUD.jsx';
import ScoreLibrary, { ScoreAttribution } from './ScoreLibrary.jsx';
import useViolinPlayback from './useViolinPlayback.js';
import ViolinPlaybackControls from './ViolinPlaybackControls.jsx';
import { SCORE_LIBRARY } from './scoreLibrary.js';
export default function ScorePractice({
  getAudioContext,
  reference,
  score,
  setScore,
  lesson,
  renderGuide,
  renderAction,
  onActivityChange,
}) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [showResults, setShowResults] = useState(false);
  const [startBeat, setStartBeat] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(!score);
  const [loadingPreset, setLoadingPreset] = useState(null);
  const preset = SCORE_LIBRARY.find((item) => item.id === score?.libraryId);
  const [trackId, setTrackId] = useState(0),
    [tempo, setTempo] = useState(0);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(''),
    [hz, setHz] = useState(null),
    [, setRevision] = useState(0),
    [startBar, setStartBar] = useState(0);
  const track = score?.tracks[trackId],
    events = useMemo(() => (track ? timedEvents(track, tempo || null) : []), [track, tempo]);
  const duration = track ? secondsAt(track, track.duration, tempo || null) : 0;
  const model = useRef(createScoreAnalysis([])),
    session = useRef({ token: 0 }),
    mounted = useRef(true),
    input = useRef(null),
    scoreHeading = useRef(null),
    focusHeading = useRef(null),
    guideHeading = useRef(null),
    importAttempt = useRef(0),
    position = useRef(0),
    initial = useRef(true);
  const [auditionMode, setAuditionMode] = useState(false);
  const preview = useViolinPlayback(getAudioContext, {
    onTime: (value) => {
      position.current = value;
      setTime(value);
    },
  });
  const audioActive = preview.playing || preview.loading;
  function stopPreview() {
    if (auditionMode) {
      model.current = createScoreAnalysis(events, Math.max(0, position.current));
      initial.current = false;
    }
    preview.stop();
    setAuditionMode(false);
  }
  function listen(at = null) {
    if (preview.loading) {
      stopPreview();
      return;
    }
    stop();
    const from =
      at ??
      (position.current >= duration
        ? secondsAt(track, startBeat, tempo || null)
        : Math.max(0, position.current));
    setAuditionMode(true);
    void preview.play(events, duration, reference, from);
  }
  function stop(update = true) {
    const run = session.current;
    run.token++;
    cancelAnimationFrame(run.frame);
    run.stream?.getTracks().forEach((t) => t.stop());
    run.source?.disconnect();
    run.analyser?.disconnect();
    run.stream = null;
    if (update && mounted.current) {
      setPlaying(false);
      setBusy(false);
      setHz(null);
      setRevision((n) => n + 1);
    }
  }
  function reset(at = 0) {
    stopPreview();
    stop();
    model.current = createScoreAnalysis(events, at);
    position.current = at;
    initial.current = true;
    setTime(at);
    setRevision((n) => n + 1);
  }
  useEffect(() => {
    reset(0);
    setStartBar(0);
    setStartBeat(0);
  }, [events]);
  useEffect(() => {
    mounted.current = true;
    const previousAnchor = document.body.style.overflowAnchor;
    document.body.style.overflowAnchor = 'none';
    const hide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      mounted.current = false;
      document.body.style.overflowAnchor = previousAnchor;
      importAttempt.current++;
      stop(false);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
    };
  }, []);
  useEffect(() => {
    onActivityChange?.(playing || busy || audioActive);
  }, [playing, busy, audioActive, onActivityChange]);
  async function load(file, libraryItem = null) {
    if (!file && !libraryItem) return;
    stopPreview();
    stop();
    const token = ++importAttempt.current;
    setImporting(true);
    setLoadingPreset(libraryItem?.id || null);
    setError('');
    try {
      if (libraryItem) {
        const response = await fetch(
          `${import.meta.env.BASE_URL}scores/${libraryItem.id}.musicxml`,
        );
        if (!response.ok) throw new Error('fetch');
        file = new File([await response.text()], `${libraryItem.id}.musicxml`);
      }
      const parsed = await importScore(file);
      if (!mounted.current || token !== importAttempt.current) return;
      setTrackId(0);
      setTempo(0);
      setScore(libraryItem ? { ...parsed, libraryId: libraryItem.id } : parsed);
      setLibraryOpen(false);
      requestAnimationFrame(() => {
        if (!mounted.current || token !== importAttempt.current) return;
        scoreHeading.current?.focus({ preventScroll: true });
        scoreHeading.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
          block: 'start',
        });
      });
    } catch (e) {
      if (mounted.current && token === importAttempt.current)
        setError(
          libraryItem
            ? text(
                '曲谱加载失败，请检查网络后重试。',
                'Could not load the score. Check your connection and try again.',
              )
            : e.message === 'size'
              ? text('文件过大，请选择 10 MB 以内的曲谱。', 'Choose a score under 10 MB.')
              : text(
                  '无法读取曲谱。请使用有效的 MusicXML、MXL 或 MIDI 文件。',
                  'Could not read this score. Choose a valid MusicXML, MXL, or MIDI file.',
                ),
        );
    } finally {
      if (mounted.current && token === importAttempt.current) {
        setImporting(false);
        setLoadingPreset(null);
      }
      if (input.current) input.current.value = '';
    }
  }
  async function start(seekBeat = null) {
    if (busy || !events.length) return;
    stopPreview();
    if (typeof seekBeat === 'number') {
      const selected = scoreStartAtBeat(track, seekBeat, tempo || null);
      if (!selected) return;
      setStartBar(selected.bar);
      setStartBeat(selected.beat);
      position.current = selected.time;
      model.current = createScoreAnalysis(events, selected.time);
      initial.current = false;
      setTime(selected.time);
      setHz(null);
      if (playing && session.current.stream) {
        const run = session.current;
        Object.assign(run, {
          origin: run.context.currentTime,
          offset: selected.time,
          startAt: selected.time,
        });
        return;
      }
    }
    setError('');
    setBusy(true);
    const token = ++session.current.token;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone');
      const ctx = await getAudioContext();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: AUDIO_SAMPLE_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!mounted.current || token !== session.current.token) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      if (position.current >= duration) {
        position.current = secondsAt(track, startBeat, tempo || null);
        model.current = createScoreAnalysis(events, position.current);
        initial.current = true;
      }
      const source = ctx.createMediaStreamSource(media),
        analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSIS_BUFFER_SIZE;
      source.connect(analyser);
      const run = session.current;
      Object.assign(run, { stream: media, source, analyser, context: ctx });
      const buffer = new Float32Array(analyser.fftSize),
        countIn = initial.current
          ? (4 * 60) / (tempo || track.tempos.findLast((t) => t.beat <= startBeat)?.bpm || 80)
          : 0;
      Object.assign(run, {
        origin: ctx.currentTime,
        offset: position.current - countIn,
        startAt: position.current,
      });
      initial.current = false;
      setPlaying(true);
      setBusy(false);
      model.current.lastTime = null;
      model.current.lastHz = null;
      model.current.lastVoiced = -Infinity;
      model.current.candidate = null;
      let last = -Infinity,
        lastPaint = -Infinity;
      const tick = (stamp) => {
        if (token !== session.current.token) return;
        const elapsed = ctx.currentTime - run.origin + run.offset;
        const analysisTime = nextAnalysisTime(last, stamp);
        if (analysisTime !== null) {
          last = analysisTime;
          position.current = elapsed;
          analyser.getFloatTimeDomainData(buffer);
          const pitch = detectPitch(buffer, ctx.sampleRate);
          if (elapsed >= Math.max(run.startAt, model.current.from)) {
            analyseScore(model.current, elapsed, pitch, reference);
            if (stamp - lastPaint >= 65) {
              setHz(pitch);
              setTime(elapsed);
              setRevision((n) => n + 1);
              lastPaint = stamp;
            }
          } else {
            model.current.lastHz = pitch;
            if (pitch) model.current.lastVoiced = elapsed;
            setTime(elapsed);
            setHz(null);
          }
          if (elapsed >= duration) {
            position.current = duration;
            setTime(duration);
            stop();
            return;
          }
        }
        run.frame = requestAnimationFrame(tick);
      };
      run.frame = requestAnimationFrame(tick);
    } catch {
      if (mounted.current && token === session.current.token) {
        stop();
        setError(
          text(
            '无法开启麦克风。请检查权限，并通过 HTTPS 或 localhost 打开。',
            'Microphone unavailable. Check permissions and use HTTPS or localhost.',
          ),
        );
      }
    }
  }
  const offset = track ? secondsAt(track, startBeat, tempo || null) : 0;
  const counting = playing && time < offset;
  const index = currentEvent(events, Math.max(time, offset)),
    event = events[index],
    focus = counting
      ? startBar
      : track
        ? Math.max(
            0,
            track.measures.findLastIndex(
              (m) => secondsAt(track, m.beat, tempo || null) <= Math.max(0, time),
            ),
          )
        : 0,
    done = time >= duration && !!score;
  const result = index >= 0 ? model.current.results[index] : null,
    summary = scoreSummary(model.current, time);
  const deviation =
    event?.midi != null && hz ? centsOff(hz, frequency(event.midi, reference)) : null;
  const nextIndex = done
    ? events.length - 1
    : index >= 0 && !counting
      ? index
      : events.findIndex((e) => e.end > Math.max(offset, time));
  return (
    <section
      className={'tuner score-practice' + (playing || preview.playing ? ' is-playing' : '')}
      aria-label={
        lesson ? text('初学者练习', 'Beginner practice') : text('曲谱练习', 'Score practice')
      }
    >
      <div className="panel-top">
        <span className="panel-title">
          <span className="olive-dot" />
          {lesson ? text('初学者练习', 'Beginner practice') : text('曲谱练习', 'Score practice')}
          <span className="tag">{lesson ? 'GUIDED PRACTICE' : 'LIVE ANALYSIS'}</span>
        </span>
        <span className="reference">A₄ = {reference} Hz</span>
      </div>
      <div className="score-body">
        <div className="score-heading">
          <div>
            <h2 ref={scoreHeading} tabIndex={-1}>
              {lesson
                ? lesson.title[lang]
                : preset?.title[lang] ||
                  score?.title ||
                  text('让曲谱带领下一步', 'Your next note, in view')}
            </h2>
            <p>
              {lesson
                ? text(
                    '跟随谱面和动作提示，慢慢练好每一步。',
                    'Follow the score and action cues, one calm step at a time.',
                  )
                : text(
                    '选择预置曲目或导入曲谱，在演奏中查看音高与节奏。',
                    'Choose a library piece or import a score. See your pitch and timing as you play.',
                  )}
            </p>
          </div>
          {!lesson && (
            <label className={'score-import ' + (importing ? 'disabled' : '')}>
              <Upload size={16} />
              {importing ? text('正在导入…', 'Importing…') : text('导入曲谱', 'Import score')}
              <input
                ref={input}
                disabled={importing || busy}
                type="file"
                accept=".musicxml,.xml,.mxl,.mid,.midi"
                aria-label={text('导入曲谱文件', 'Import score file')}
                onChange={(e) => load(e.target.files[0])}
              />
            </label>
          )}
        </div>
        {!lesson && (
          <>
            <ScoreLibrary
              open={libraryOpen}
              onToggle={() => setLibraryOpen((value) => !value)}
              onSelect={(item) => load(null, item)}
              selectedId={preset?.id}
              disabled={playing || busy || audioActive || importing}
              loading={loadingPreset}
            />
            {preset && <ScoreAttribution item={preset} />}
            <span role="status" className="library-status">
              {importing ? text('正在加载曲谱…', 'Loading score…') : ''}
            </span>
          </>
        )}
        {renderGuide && (
          <div ref={guideHeading}>
            {renderGuide({
              event,
              index,
              time,
              counting,
              done,
              playing: playing || preview.playing,
            })}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {!score ? (
          <div className="score-empty">
            <Music2 size={42} />
            <h3>MusicXML · MXL · MIDI</h3>
            <p>
              {text(
                '曲谱在本地解析，无需上传。推荐使用 MusicXML 保留原始记谱。',
                'Scores stay on your device. MusicXML preserves the original notation.',
              )}
            </p>
            <button
              className="secondary-button"
              disabled={importing || busy}
              onClick={() => {
                setScore(parseMusicXml(DEMO_XML));
                setTrackId(0);
                setTempo(0);
              }}
            >
              {text('试用示例曲谱', 'Try a demo score')}
            </button>
          </div>
        ) : (
          <>
            <div className="score-controls">
              {!lesson && (
                <label>
                  {text('声部 / 声部编号', 'Part / voice')}
                  <select
                    value={trackId}
                    disabled={playing || busy || audioActive}
                    onChange={(e) => setTrackId(+e.target.value)}
                  >
                    {score.tracks.map((tr, i) => (
                      <option key={tr.id} value={i}>
                        {tr.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {text('练习速度', 'Practice tempo')}
                <select
                  value={tempo}
                  disabled={playing || busy || audioActive}
                  onChange={(e) => setTempo(+e.target.value)}
                >
                  <option value={0}>
                    {lesson
                      ? `${lesson.bpm} BPM · ${text('建议速度', 'Suggested')}`
                      : text('跟随谱面速度', 'Score tempo')}
                  </option>
                  {(lesson
                    ? [30, 40, 50, 60, 70, 80]
                    : [40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200]
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n} BPM
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text('起始小节', 'Start at bar')}
                <select
                  value={startBar}
                  disabled={playing || busy || audioActive}
                  onChange={(e) => {
                    const bar = +e.target.value;
                    setStartBar(bar);
                    setStartBeat(track.measures[bar].beat);
                    reset(secondsAt(track, track.measures[bar].beat, tempo || null));
                  }}
                >
                  {track.measures.map((m, i) => (
                    <option key={i} value={i}>
                      {m.bar}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(track.complex || score.midi) && (
              <p className="score-notice">
                {score.midi
                  ? text(
                      'MIDI 转为简化谱面；每轨选择单音旋律，重叠音符取先出现的最高音。拍号变化不展开。',
                      'MIDI uses simplified notation and a monophonic line per track. Overlaps keep the first, highest note; meter changes are not expanded.',
                    )
                  : text(
                      '按谱面书写顺序练习，不展开反复；和弦分析最高音。',
                      'Practice follows written order without repeats. Chords use the highest note for analysis.',
                    )}
              </p>
            )}
            <div className="score-view-heading" ref={focusHeading}>
              <span>
                {text('当前小节', 'Current bar')} <b>{track.measures[focus]?.bar}</b>
              </span>
              <span>{text('完整曲谱 · 左右滑动', 'Full score · swipe to explore')}</span>
            </div>
            <ScoreNotation
              track={track}
              onSeek={(beat) => {
                if (auditionMode) {
                  const selected = scoreStartAtBeat(track, beat, tempo || null);
                  if (selected) {
                    setStartBar(selected.bar);
                    setStartBeat(selected.beat);
                    listen(selected.time);
                  }
                } else start(beat);
              }}
              action={renderAction?.({
                event,
                index,
                time,
                counting,
                done,
                playing: playing || preview.playing,
              })}
              renderOverlay={({ expanded }) => (
                <ScoreHUD
                  event={event || events.find((e) => e.start >= time)}
                  next={
                    done
                      ? []
                      : events.slice(
                          Math.max(0, nextIndex + (counting ? 0 : 1)),
                          Math.max(0, nextIndex + (counting ? 0 : 1)) + 3,
                        )
                  }
                  reference={reference}
                  counting={counting}
                  done={done}
                  hz={auditionMode ? null : hz}
                  deviation={auditionMode ? null : deviation}
                  onset={auditionMode ? null : result?.onset}
                  count={Math.ceil(
                    (offset - time) /
                      (60 /
                        (tempo || track.tempos.findLast((t) => t.beat <= startBeat)?.bpm || 80)),
                  )}
                  transport={
                    <div className="score-actions">
                      <button
                        className={'mic-button ' + (playing ? 'listening' : '')}
                        disabled={busy || importing}
                        onClick={playing ? () => stop() : start}
                      >
                        {playing ? <Square size={16} /> : <Play size={17} />}{' '}
                        {busy
                          ? text('正在开启…', 'Starting…')
                          : playing
                            ? text('暂停演奏', 'Pause')
                            : done
                              ? text('再次演奏', 'Play again')
                              : initial.current
                                ? lesson
                                  ? text('开始练习', 'Start exercise')
                                  : text('开始演奏', 'Start playing')
                                : text('继续演奏', 'Resume')}
                      </button>
                      <ViolinPlaybackControls
                        player={preview}
                        disabled={busy || importing}
                        label={text('试听曲谱', 'Listen to score')}
                        onPlay={() => listen()}
                        onStop={stopPreview}
                      />
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => reset(offset)}
                      >
                        <RotateCcw size={15} />
                        {text('重新开始', 'Restart')}
                      </button>
                    </div>
                  }
                  time={time}
                  duration={duration}
                  error={expanded ? error : ''}
                />
              )}
              measure={focus || 0}
              playing={playing || preview.playing}
              noteDuration={event ? event.end - event.start : 0.5}
              beat={Math.max(event?.beat ?? track.measures[focus].beat, track.measures[focus].beat)}
            />
            {!auditionMode && (
              <div className="score-stats">
                <div>
                  <b>{summary.pitch === null ? '—' : `${summary.pitch}%`}</b>
                  <span>{text('有声采样音准 ±20 音分', 'Voiced samples within ±20 cents')}</span>
                </div>
                <div>
                  <b>{summary.coverage}%</b>
                  <span>{text('音符时长覆盖', 'Note duration coverage')}</span>
                </div>
                <div>
                  <b>{summary.rhythm === null ? '—' : `${summary.rhythm}%`}</b>
                  <span>
                    {text('起音在 ±150 ms 内', 'Onsets within ±150 ms')} · {summary.onsets}
                  </span>
                </div>
              </div>
            )}
            <p className="score-method">
              {text(
                '实时分析按速度前进，不会因错音停住。开始前有 4 拍视觉预备拍。音准与时长按已完成音符统计；节奏只统计检测到的起音。同音连奏、换弓和设备延迟可能影响起音识别。',
                'Live analysis follows tempo and continues through mistakes. Start with a four-beat visual count-in. Pitch and duration use completed notes; rhythm uses detected onsets only. Repeated legato notes, bow changes, and device latency can affect onset detection.',
              )}
            </p>
            {!auditionMode && summary.completed > 0 && (
              <details
                className="score-results"
                onToggle={(e) => setShowResults(e.currentTarget.open)}
              >
                <summary>
                  {text('逐音分析', 'Note-by-note analysis')} · {summary.completed} /{' '}
                  {summary.total}
                </summary>
                <div className="score-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          text('小节', 'Bar'),
                          text('音符', 'Note'),
                          text('音准', 'Pitch'),
                          text('覆盖', 'Coverage'),
                          text('起音', 'Onset'),
                        ].map((s) => (
                          <th key={s}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {showResults &&
                        events
                          .filter(
                            (e) => e.midi !== null && e.end <= time && e.end > model.current.from,
                          )
                          .map((e) => {
                            const r = model.current.results[e.index];
                            return (
                              <tr key={e.index}>
                                <td>{e.bar}</td>
                                <td>{nameOf(e)}</td>
                                <td>
                                  {r.samples
                                    ? `${Math.round((100 * r.accurate) / r.samples)}%`
                                    : '—'}
                                </td>
                                <td>
                                  {Math.min(
                                    100,
                                    Math.round((100 * r.voicedSeconds) / (e.end - e.start)),
                                  )}
                                  %
                                </td>
                                <td>
                                  {r.onset === null
                                    ? text('未检测到', 'Not detected')
                                    : `${Math.round(r.onset * 1000)} ms`}
                                </td>
                              </tr>
                            );
                          })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
      <div className="panel-bottom">
        <span>
          <span className="secure-dot" />
          {text('曲谱与声音仅在本地分析', 'Scores and audio stay on your device')}
        </span>
        <span>{text('单音小提琴练习', 'Monophonic violin practice')}</span>
      </div>
    </section>
  );
}
