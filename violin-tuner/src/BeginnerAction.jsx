import React from 'react';
import { useLanguage } from './i18n.jsx';
const stringOf = (midi) => ({ 55: 'G', 62: 'D', 69: 'A', 76: 'E' })[midi] || 'D';
export default function BeginnerAction({ lesson, event, index, time, counting, done }) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const cue = done ? lesson.cues.at(-1) : lesson.cues[Math.max(0, index)] || lesson.cues.at(-1);
  const label = done
    ? text('本轮完成，休息并自检', 'Round complete. Rest and review.')
    : lesson.instrument === 'guitar'
      ? counting
        ? text('跟随预备拍，准备拨弦', 'Follow the count-in. Prepare to pluck.')
        : text(
            `拨弦 · 第 ${cue.string} 弦 · ${cue.fret === 0 ? '空弦' : `${cue.fret} 品`}`,
            `Pluck · string ${cue.string} · ${cue.fret === 0 ? 'open' : `fret ${cue.fret}`}`,
          )
      : counting
        ? text('跟随预备拍，先把弓放稳', 'Follow the count-in. Settle your bow.')
        : cue.phase === 'stop'
          ? text('停 · 弓停住，再调整右臂', 'STOP · stop the bow, then adjust the arm')
          : cue.phase === 'place'
            ? text(
                `放 · 在 ${stringOf(cue.nextMidi)} 弦放稳弓`,
                `PLACE · settle on the ${stringOf(cue.nextMidi)} string`,
              )
            : cue.phase === 'finish'
              ? text('停 · 放松右臂，准备结束', 'REST · relax the right arm to finish')
              : text(
                  `${cue.bow === 'down' ? '下弓' : '上弓'} · ${lesson.instrument === 'guitar' ? text(`第 ${cue.group} / ${cue.total} 轮`, `Round ${cue.group} / ${cue.total}`) : cue.finger !== undefined ? 'D' : stringOf(cue.midi)} 弦`,
                  `${cue.bow === 'down' ? 'Down-bow' : 'Up-bow'} · ${cue.finger !== undefined ? 'D' : stringOf(cue.midi)} string`,
                );
  const beat =
    event && !done && !counting
      ? Math.min(
          cue.beats - 1,
          Math.max(0, Math.floor(((time - event.start) / (event.end - event.start)) * cue.beats)),
        )
      : 0;
  return (
    <div className={'beginner-cue' + (cue.midi === null ? ' resting' : '')}>
      <div className="beginner-bow" aria-hidden="true">
        {done
          ? '✓'
          : counting
            ? '…'
            : cue.midi === null
              ? '𝄽'
              : lesson.instrument === 'guitar'
                ? '♪'
                : cue.bow === 'down'
                  ? '∏'
                  : '∨'}
      </div>
      <div>
        <small>{done ? text('完成', 'COMPLETE') : text('当前动作', 'CURRENT ACTION')}</small>
        <strong>{label}</strong>
        <span>
          {lesson.instrument === 'guitar'
            ? text(`第 ${cue.group} / ${cue.total} 轮`, `Round ${cue.group} / ${cue.total}`)
            : cue.finger !== undefined
              ? text(
                  `${cue.finger === 0 ? '空弦' : `${cue.finger} 指`} · 第 ${cue.group} / ${cue.total} 轮`,
                  `${cue.finger === 0 ? 'Open string' : `Finger ${cue.finger}`} · Round ${cue.group} / ${cue.total}`,
                )
              : cue.group
                ? text(
                    `${cue.pair !== undefined ? ['D ↔ A · ', 'A ↔ E · ', 'D ↔ G · '][cue.pair] : ''}第 ${cue.group} / ${cue.total} 组`,
                    `${cue.pair !== undefined ? ['D ↔ A · ', 'A ↔ E · ', 'D ↔ G · '][cue.pair] : ''}Pair ${cue.group} / ${cue.total}`,
                  )
                : text('停下来，重新落弓找位置', 'Stop and find a settled bow position')}
        </span>
      </div>
      <div className="beginner-beats" aria-label={text('当前动作拍数', 'Beats in this action')}>
        {Array.from({ length: cue.beats }, (_, i) => (
          <span key={i} className={i === beat && !counting && !done ? 'active' : ''}>
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
