import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { frequency, noteName } from './pitch.js';
import { SCORE_ACCURACY_CENTS } from './practiceFeedback.js';

const nameOf = (event) => {
  if (!event || event.midi === null) return '𝄽';
  const note = noteName(event.midi);
  return `${note.name}${note.octave}`;
};
export default function ScoreHUD({
  event,
  next,
  reference,
  counting,
  count,
  done,
  hz,
  deviation,
  onset,
  transport,
  time,
  duration,
  error,
  feedback = null,
  personalBest = 0,
  playing = false,
}) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [collapsed, setCollapsed] = useState(false);
  const judgment = feedback?.last;
  const fresh = judgment && time - judgment.time <= 0.85;
  const matching =
    playing &&
    event?.midi != null &&
    deviation !== null &&
    Math.abs(deviation) <= SCORE_ACCURACY_CENTS + 1e-6;
  const verdict = fresh ? judgment.type : null;
  return (
    <section
      className={'score-hud' + (collapsed ? ' collapsed' : '')}
      aria-label={text('演奏提示浮窗', 'Performance overlay')}
      aria-live="off"
    >
      <div className="hud-readout">
        <div className={'hud-note' + (matching ? ' is-on-pitch' : '')}>
          <small>
            {counting
              ? text('预备拍', 'COUNT IN')
              : done
                ? text('演奏完成', 'FINISHED')
                : text('当前音符', 'PLAY NOW')}
          </small>
          <strong>{counting ? count : done ? '✓' : nameOf(event)}</strong>
          {!collapsed && (
            <span>
              {event?.midi != null
                ? `${frequency(event.midi, reference).toFixed(1)} Hz · ${event.duration} ♩`
                : text('休止 / 等待起音', 'Rest / wait for the entrance')}
            </span>
          )}
        </div>
        {!collapsed && (
          <div
            className={
              'hud-pitch' +
              (deviation !== null && Math.abs(deviation) <= SCORE_ACCURACY_CENTS
                ? ' score-good'
                : '')
            }
          >
            <small>{text('实际音高', 'DETECTED PITCH')}</small>
            <strong>{hz ? `${hz.toFixed(1)} Hz` : '—'}</strong>
            <span>
              {deviation !== null
                ? `${deviation > 0 ? '+' : ''}${Math.round(deviation)} ${text('音分', 'cents')}`
                : text('单音演奏', 'Play one note at a time')}
              {onset != null &&
                ` · ${text('起音', 'onset')} ${onset > 0 ? '+' : ''}${Math.round(onset * 1000)} ms`}
            </span>
          </div>
        )}
        <button
          className="hud-collapse"
          type="button"
          aria-label={
            collapsed ? text('展开提示', 'Expand cues') : text('收起提示', 'Collapse cues')
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {feedback && (
        <div
          className={'hud-feedback' + (matching ? ' is-matching' : '')}
          aria-label={text('命中与连击', 'Pitch hits and combo')}
        >
          <div className="hud-judgment-slot">
            {verdict ? (
              <div
                key={`${judgment.id}:${judgment.time}`}
                className={`hud-judgment-burst is-${verdict}`}
              >
                <span className="hit-emblem" aria-hidden="true">
                  {verdict === 'miss' ? '−' : '✦'}
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <b>
                    {verdict === 'perfect'
                      ? 'PERFECT'
                      : verdict === 'good'
                        ? 'GOOD'
                        : text('漏音', 'MISS')}
                  </b>
                  <small>
                    {verdict === 'miss'
                      ? text('跟上下一音', 'Catch the next note')
                      : text('音高命中', 'Pitch hit')}
                  </small>
                </div>
              </div>
            ) : (
              <span className={'hud-live-judgment' + (matching ? ' is-correct' : '')}>
                <i aria-hidden="true" />
                {counting
                  ? text('准备好', 'Get ready')
                  : done
                    ? text('本轮完成', 'Run complete')
                    : !playing
                      ? text('准备演奏', 'Ready to play')
                      : event?.midi == null
                        ? text('休止', 'Rest')
                        : matching
                          ? text('拉准了，保持', 'On pitch · hold')
                          : hz
                            ? deviation < 0
                              ? text('偏低，稍抬高', 'Flat · raise pitch')
                              : text('偏高，稍降低', 'Sharp · lower pitch')
                            : text('等待琴声', 'Listening for your note')}
              </span>
            )}
          </div>
          <div className="hud-combo" aria-label={text('当前连击', 'Current combo')}>
            <strong
              key={`${feedback.serial}:${feedback.combo}`}
              className={verdict && verdict !== 'miss' ? 'combo-pop' : ''}
            >
              {feedback.combo}
            </strong>
            <span>
              COMBO
              <small>
                {text('本轮', 'RUN')} {feedback.maxCombo} · {text('最高', 'BEST')}{' '}
                {Math.max(personalBest, feedback.maxCombo)}
              </small>
            </span>
          </div>
        </div>
      )}
      {!collapsed && (
        <>
          <div className="hud-upcoming" aria-label={text('接下来演奏', 'Upcoming notes')}>
            <small>{done ? text('本轮完成', 'COMPLETE') : text('接下来', 'UP NEXT')}</small>
            {next.map((e) => (
              <div key={e.index}>
                <b>{nameOf(e)}</b>
                <span>
                  {text('小节', 'Bar')} {e.bar} · {e.duration} ♩
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {error && (
        <p className="hud-error" role="alert">
          {error}
        </p>
      )}
      <div className="hud-footer">
        <div className="hud-transport">{transport}</div>
        <div className="hud-progress">
          <progress
            aria-label={text('演奏进度', 'Performance progress')}
            value={Math.max(0, time)}
            max={duration || 1}
          />
          <span>
            {Math.max(0, time).toFixed(1)} / {duration.toFixed(1)} s
          </span>
        </div>
      </div>
    </section>
  );
}
