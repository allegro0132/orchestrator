import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Play, Square, RotateCcw, Music2 } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { importScore, parseMusicXml, DEMO_XML, timedEvents, secondsAt } from './score.js';
import { createScoreAnalysis, analyseScore, currentEvent, scoreSummary } from './scoreAnalysis.js';
import { detectPitch, frequency, centsOff, noteName } from './pitch.js';
import { AUDIO_SAMPLE_RATE, ANALYSIS_BUFFER_SIZE, ANALYSIS_INTERVAL_MS } from './audioConfig.js';
import ScoreNotation from './ScoreNotation.jsx';
const nameOf = (e) => {
  if (!e || e.midi === null) return '𝄽';
  const n = noteName(e.midi);
  return `${n.name}${n.octave}`;
};
export default function ScorePractice({
  getAudioContext,
  reference,
  score,
  setScore,
  lesson,
  renderGuide,
  onActivityChange,
}) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [showResults, setShowResults] = useState(false);
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
    focusHeading = useRef(null),
    guideHeading = useRef(null),
    importAttempt = useRef(0),
    position = useRef(0),
    initial = useRef(true);
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
  }, [events]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      mounted.current = false;
      importAttempt.current++;
      stop(false);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
    };
  }, []);
  useEffect(() => {
    onActivityChange?.(playing || busy);
  }, [playing, busy, onActivityChange]);
  async function load(file) {
    if (!file) return;
    stop();
    const token = ++importAttempt.current;
    setImporting(true);
    setError('');
    try {
      const parsed = await importScore(file);
      if (!mounted.current || token !== importAttempt.current) return;
      setTrackId(0);
      setTempo(0);
      setScore(parsed);
    } catch (e) {
      if (mounted.current && token === importAttempt.current)
        setError(
          e.message === 'size'
            ? text('文件过大，请选择 10 MB 以内的曲谱。', 'Choose a score under 10 MB.')
            : text(
                '无法读取曲谱。请使用有效的 MusicXML、MXL 或 MIDI 文件。',
                'Could not read this score. Choose a valid MusicXML, MXL, or MIDI file.',
              ),
        );
    } finally {
      if (mounted.current && token === importAttempt.current) setImporting(false);
      if (input.current) input.current.value = '';
    }
  }
  async function start() {
    if (busy || !events.length) return;
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
        position.current = secondsAt(track, track.measures[startBar].beat, tempo || null);
        model.current = createScoreAnalysis(events, position.current);
        initial.current = true;
      }
      const source = ctx.createMediaStreamSource(media),
        analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSIS_BUFFER_SIZE;
      source.connect(analyser);
      const run = session.current;
      Object.assign(run, { stream: media, source, analyser });
      const buffer = new Float32Array(analyser.fftSize),
        countIn = initial.current
          ? (4 * 60) /
            (tempo ||
              track.tempos.findLast((t) => t.beat <= track.measures[startBar].beat)?.bpm ||
              80)
          : 0;
      const origin = ctx.currentTime,
        offset = position.current - countIn,
        startAt = position.current;
      initial.current = false;
      setPlaying(true);
      setBusy(false);
      (lesson ? guideHeading.current : focusHeading.current)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      model.current.lastTime = null;
      model.current.lastHz = null;
      model.current.lastVoiced = -Infinity;
      model.current.candidate = null;
      let last = -Infinity,
        lastPaint = -Infinity;
      const tick = (stamp) => {
        if (token !== session.current.token) return;
        const elapsed = ctx.currentTime - origin + offset;
        if (stamp - last >= ANALYSIS_INTERVAL_MS) {
          last = stamp;
          position.current = elapsed;
          analyser.getFloatTimeDomainData(buffer);
          const pitch = detectPitch(buffer, ctx.sampleRate);
          if (elapsed >= Math.max(startAt, model.current.from)) {
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
  const offset = track ? secondsAt(track, track.measures[startBar].beat, tempo || null) : 0;
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
  const firstCard = done
    ? Math.max(0, events.length - 7)
    : Math.max(0, nextIndex - (counting ? 0 : 1));
  const upcoming = events.slice(firstCard, firstCard + 7);
  return (
    <section
      className={'tuner score-practice' + (playing ? ' is-playing' : '')}
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
            <h2>
              {lesson
                ? lesson.title[lang]
                : score?.title || text('让曲谱带领下一步', 'Your next note, in view')}
            </h2>
            <p>
              {lesson
                ? text(
                    '跟随谱面和动作提示，慢慢练好每一步。',
                    'Follow the score and action cues, one calm step at a time.',
                  )
                : text(
                    '导入曲谱，在演奏中查看音高与节奏。',
                    'Import a score. See your pitch and timing as you play.',
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
        {renderGuide && (
          <div ref={guideHeading}>
            {renderGuide({ event, index, time, counting, done, playing })}
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
                    disabled={playing || busy}
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
                  disabled={playing || busy}
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
                  disabled={playing || busy}
                  onChange={(e) => {
                    const bar = +e.target.value;
                    setStartBar(bar);
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
              measure={focus || 0}
              playing={playing}
              noteDuration={event ? event.end - event.start : 0.5}
              beat={Math.max(event?.beat ?? track.measures[focus].beat, track.measures[focus].beat)}
            />
            <div className="score-now" aria-live="off">
              <div>
                <span>
                  {counting
                    ? text('预备拍', 'Count in')
                    : done
                      ? text('演奏完成', 'Finished')
                      : text('当前音符', 'Play now')}
                </span>
                <strong>
                  {counting
                    ? Math.ceil(
                        (offset - time) /
                          (60 /
                            (tempo ||
                              track.tempos.findLast((t) => t.beat <= track.measures[startBar].beat)
                                ?.bpm ||
                              80)),
                      )
                    : done
                      ? '✓'
                      : nameOf(event || events.find((e) => e.start >= time))}
                </strong>
                <small>
                  {event?.midi != null
                    ? `${frequency(event.midi, reference).toFixed(1)} Hz · ${event.duration} ${text('四分音符拍', 'quarter beats')}`
                    : text('休止 / 等待起音', 'Rest / wait for the entrance')}
                </small>
              </div>
              <div className={deviation !== null && Math.abs(deviation) <= 20 ? 'score-good' : ''}>
                <span>{text('实际音高', 'Detected pitch')}</span>
                <strong>{hz ? `${hz.toFixed(1)} Hz` : '—'}</strong>
                <small>
                  {deviation !== null
                    ? `${deviation > 0 ? '+' : ''}${Math.round(deviation)} ${text('音分', 'cents')}`
                    : text('单音演奏', 'Play one note at a time')}
                </small>
              </div>
              <div>
                <span>{text('起音偏差', 'Onset timing')}</span>
                <strong>
                  {result?.onset != null
                    ? `${result.onset > 0 ? '+' : ''}${Math.round(result.onset * 1000)} ms`
                    : '—'}
                </strong>
                <small>{text('负数为提前，正数为延后', '− early · + late')}</small>
              </div>
            </div>
            <div className="score-next" aria-label={text('接下来演奏', 'Upcoming notes')}>
              {upcoming.map((e) => (
                <div key={e.index} className={e.index === index ? 'current' : ''}>
                  <small>
                    {e.index === index
                      ? text('现在', 'NOW')
                      : e.index < index
                        ? text('之前', 'PREV')
                        : text('之后', 'NEXT')}
                  </small>
                  <b>{nameOf(e)}</b>
                  <span>
                    {text('小节', 'Bar')} {e.bar} · {e.duration} ♩
                    {lesson && (
                      <em>
                        {lesson.cues[e.index]?.midi === null
                          ? lesson.cues[e.index]?.phase === 'stop'
                            ? text('停弓', 'Stop')
                            : lesson.cues[e.index]?.phase === 'finish'
                              ? text('结束', 'Finish')
                              : text('放稳', 'Place')
                          : lesson.cues[e.index]?.finger !== undefined
                            ? lesson.cues[e.index].finger === 0
                              ? text('空弦', 'Open string')
                              : text(
                                  `${lesson.cues[e.index].finger} 指`,
                                  `Finger ${lesson.cues[e.index].finger}`,
                                )
                            : lesson.cues[e.index]?.bow === 'down'
                              ? text('下弓', 'Down-bow')
                              : text('上弓', 'Up-bow')}
                      </em>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="score-progress">
              <progress
                aria-label={text('演奏进度', 'Performance progress')}
                value={Math.max(0, time)}
                max={duration || 1}
              />
              <span>
                {Math.max(0, time).toFixed(1)} / {duration.toFixed(1)} s
              </span>
            </div>
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
              <button className="secondary-button" disabled={busy} onClick={() => reset(offset)}>
                <RotateCcw size={15} />
                {text('重新开始', 'Restart')}
              </button>
            </div>
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
            <p className="score-method">
              {text(
                '实时分析按速度前进，不会因错音停住。开始前有 4 拍视觉预备拍。音准与时长按已完成音符统计；节奏只统计检测到的起音。同音连奏、换弓和设备延迟可能影响起音识别。',
                'Live analysis follows tempo and continues through mistakes. Start with a four-beat visual count-in. Pitch and duration use completed notes; rhythm uses detected onsets only. Repeated legato notes, bow changes, and device latency can affect onset detection.',
              )}
            </p>
            {summary.completed > 0 && (
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
