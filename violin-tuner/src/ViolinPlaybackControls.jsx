import React from 'react';
import { Headphones, Pause, Square } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { useInstrument } from './InstrumentContext.jsx';
export default function ViolinPlaybackControls({
  player,
  onPlay,
  onStop,
  disabled = false,
  label,
}) {
  const { instrument } = useInstrument();
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  return (
    <div
      className="violin-playback"
      aria-label={text(`${instrument.zh}试听`, `${instrument.en} playback`)}
    >
      <button
        className="secondary-button"
        disabled={disabled}
        onClick={player.playing ? player.pause : onPlay}
      >
        {player.playing ? <Pause size={15} /> : <Headphones size={15} />}
        {player.loading
          ? text('取消加载', 'Cancel loading')
          : player.playing
            ? text('暂停试听', 'Pause listening')
            : player.status === 'paused'
              ? text('继续试听', 'Resume listening')
              : label}
      </button>
      {['playing', 'paused', 'loading', 'ended'].includes(player.status) && (
        <button
          className="secondary-button"
          onClick={onStop}
          aria-label={text('停止试听', 'Stop listening')}
        >
          <Square size={14} />
          {text('停止', 'Stop')}
        </button>
      )}
      <small>{text(`${instrument.zh}音色`, `${instrument.en} sound`)}</small>
      {player.error && (
        <span className="error" role="alert">
          {text(
            '音色加载或播放失败，请检查网络后重试。',
            'Instrument audio could not load or play. Check your connection and retry.',
          )}
        </span>
      )}
    </div>
  );
}
