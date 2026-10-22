import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { frequency, noteName } from './pitch.js';

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
  action,
  transport,
  time,
  duration,
  error,
}) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      className={'score-hud' + (collapsed ? ' collapsed' : '')}
      aria-label={text('演奏提示浮窗', 'Performance overlay')}
      aria-live="off"
    >
      <div className="hud-readout">
        <div className="hud-note">
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
              'hud-pitch' + (deviation !== null && Math.abs(deviation) <= 20 ? ' score-good' : '')
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
      {!collapsed && (
        <>
          {action && <div className="hud-action">{action}</div>}
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
