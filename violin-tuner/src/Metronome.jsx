import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Minus, Plus, Volume2 } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { createMetronome, normalizeMetronome, MIN_BPM, MAX_BPM, METERS } from './metronome.js';
function loadSettings() {
  try {
    return normalizeMetronome(JSON.parse(localStorage.getItem('arco-metronome')) || {});
  } catch {
    return normalizeMetronome();
  }
}
export default function Metronome({ getAudioContext }) {
  const { lang, t } = useLanguage();
  const [settings, setSettings] = useState(loadSettings),
    [draft, setDraft] = useState(() => String(settings.bpm));
  const [playing, setPlaying] = useState(false),
    [starting, setStarting] = useState(false),
    [beat, setBeat] = useState(null),
    [error, setError] = useState('');
  const engine = useRef(null),
    mounted = useRef(true),
    attempt = useRef(0);
  function stop() {
    attempt.current++;
    engine.current?.stop();
    setPlaying(false);
    setStarting(false);
    setBeat(null);
  }
  useEffect(() => {
    try {
      localStorage.setItem('arco-metronome', JSON.stringify(settings));
    } catch {}
    engine.current?.update(settings);
  }, [settings]);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', stop);
    return () => {
      mounted.current = false;
      attempt.current++;
      engine.current?.stop();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', stop);
    };
  }, []);
  function bpm(value) {
    const normalized = normalizeMetronome({ ...settings, bpm: value });
    setSettings(normalized);
    setDraft(String(normalized.bpm));
  }
  async function start() {
    if (starting) return;
    const token = ++attempt.current;
    setStarting(true);
    setError('');
    try {
      const context = await getAudioContext();
      if (!mounted.current || token !== attempt.current) return;
      if (!engine.current) engine.current = createMetronome(context, { onBeat: setBeat });
      engine.current.start(settings);
      setPlaying(true);
    } catch {
      if (mounted.current && token === attempt.current)
        setError('无法启动节拍器，请检查声音设置后重试。');
    } finally {
      if (mounted.current && token === attempt.current) setStarting(false);
    }
  }
  return (
    <section className="tuner metronome" aria-label={t('节拍器')}>
      <div className="panel-top">
        <span className="panel-title">
          <span className="olive-dot" />
          {t('节拍器')}
          <span className="tag">RHYTHM PRACTICE</span>
        </span>
        <span className="reference">{settings.beats === 6 ? '6/8' : `${settings.beats}/4`}</span>
      </div>
      <div className="metronome-body">
        <div className={'live-status ' + (playing ? 'live' : '')}>
          <span />
          {playing ? t('跟随节拍，保持稳定') : t('准备好，找到你的节奏')}
        </div>
        <div className="tempo-input">
          <button
            aria-label={t('降低速度')}
            onClick={() => bpm(settings.bpm - 1)}
            disabled={settings.bpm === MIN_BPM}
          >
            <Minus size={19} />
          </button>
          <label>
            <input
              aria-label={t('速度 BPM')}
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              step="1"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value && n >= MIN_BPM && n <= MAX_BPM)
                  setSettings({ ...settings, bpm: Math.round(n) });
              }}
              onBlur={() => bpm(Number(draft) || settings.bpm)}
            />
            <span>BPM</span>
          </label>
          <button
            aria-label={t('提高速度')}
            onClick={() => bpm(settings.bpm + 1)}
            disabled={settings.bpm === MAX_BPM}
          >
            <Plus size={19} />
          </button>
        </div>
        <input
          className="tempo-slider"
          aria-label={t('速度滑块')}
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={settings.bpm}
          onChange={(e) => bpm(+e.target.value)}
        />
        <div className="tempo-range">
          <span>{MIN_BPM} BPM</span>
          <span>{MAX_BPM} BPM</span>
        </div>
        <div className="beat-lights" aria-label={t('节拍指示')} role="group">
          {Array.from({ length: settings.beats }, (_, i) => (
            <span
              key={i}
              className={
                (beat === i && playing ? 'lit ' : '') + (i === 0 && settings.accent ? 'accent' : '')
              }
              aria-label={lang === 'zh' ? `第 ${i + 1} 拍` : `Beat ${i + 1}`}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <p className="beat-count">
          {playing && beat !== null ? `${beat + 1} / ${settings.beats}` : '—'}
          <span>{t('当前拍')}</span>
        </p>
        <div className="metronome-controls">
          <label>
            {t('拍号')}
            <select
              value={settings.beats}
              onChange={(e) => {
                setBeat(null);
                setSettings({ ...settings, beats: +e.target.value });
              }}
            >
              {METERS.map((n) => (
                <option key={n} value={n}>
                  {n === 6 ? '6/8' : `${n}/4`}
                </option>
              ))}
            </select>
          </label>
          <label className="accent-setting">
            <input
              type="checkbox"
              checked={settings.accent}
              onChange={(e) => setSettings({ ...settings, accent: e.target.checked })}
            />
            {t('首拍重音')}
          </label>
        </div>
        <label className="volume-control">
          <Volume2 size={16} />
          <span>{t('音量')}</span>
          <input
            aria-label={t('节拍器音量')}
            type="range"
            min="0"
            max="100"
            value={settings.volume}
            onChange={(e) => setSettings({ ...settings, volume: +e.target.value })}
          />
          <span>{settings.volume}%</span>
        </label>
        <button
          className={'mic-button ' + (playing ? 'listening' : '')}
          disabled={starting}
          onClick={playing ? stop : start}
        >
          {playing ? <Square size={17} /> : <Play size={18} />}{' '}
          {starting ? t('正在开启…') : playing ? t('停止节拍器') : t('开始节拍器')}
        </button>
        {error && (
          <div className="error" role="alert">
            {t(error)}
          </div>
        )}
        <p className="metronome-note">
          {t('BPM 对应每次点击；6/8 每小节点击六次。切换模式或离开页面时自动停止。')}
        </p>
      </div>
      <div className="panel-bottom">
        <span>
          <span className="secure-dot" />
          {t('无需麦克风')}
        </span>
        <span>{t('声音在设备本地生成')}</span>
      </div>
    </section>
  );
}
