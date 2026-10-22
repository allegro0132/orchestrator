import React from 'react';
import { useLanguage } from './i18n.jsx';
import { Check, RotateCcw } from 'lucide-react';
import { ACCURACY_CENTS } from './tuning.js';
import { historyPlot } from './historyPlot.js';

export default function PitchHistory({
  tracking,
  listening,
  onReset,
  accuracyCents = ACCURACY_CENTS,
}) {
  const { lang, t } = useLanguage();
  const { samples, now, progress, stats, success } = tracking;
  const { range, segments, y, current: currentPoint } = historyPlot(samples, now);
  const signed = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  const current = samples.at(-1)?.cents;
  const message = success
    ? t('调音成功')
    : !listening
      ? samples.length
        ? t('本次记录已暂停')
        : t('等待开始记录')
      : current == null
        ? t('等待持续琴声')
        : progress > 0
          ? t('音准接近，继续保持')
          : t('音准仍在波动，继续微调');
  return (
    <section
      className={'pitch-history ' + (success ? 'has-success' : '')}
      aria-label={t('近期音准记录')}
    >
      <div className="history-heading">
        <span>
          {t('最近 6 秒')}
          <small>{t('音准轨迹')}</small>
        </span>
        <span>
          ±{range} {t('音分')} · {t('固定量程')}
        </span>
      </div>
      <div className="history-chart">
        <span className="chart-high">+{range}</span>
        <span className="chart-zero">0</span>
        <span className="chart-low">−{range}</span>
        <svg
          viewBox="0 0 480 108"
          role="img"
          aria-label={t('最近六秒的音准波动曲线，绿色区域为正负 {cents} 音分').replaceAll(
            '{cents}',
            accuracyCents,
          )}
          preserveAspectRatio="none"
        >
          <rect
            x="12"
            y={y(accuracyCents)}
            width="456"
            height={y(-accuracyCents) - y(accuracyCents)}
            rx="3"
            fill="#dfe9d3"
          />
          {[16, 54, 92].map((y) => (
            <line
              key={y}
              x1="12"
              x2="468"
              y1={y}
              y2={y}
              stroke="#d9dfcf"
              strokeDasharray={y === 54 ? '3 3' : '2 5'}
            />
          ))}
          {[12, 126, 240, 354, 468].map((x) => (
            <line key={x} x1={x} x2={x} y1="10" y2="98" stroke="#e9ecdf" />
          ))}
          {segments.map((points, i) => (
            <polyline
              key={i}
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#607b47"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {segments.flat().map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.overflow ? 2.5 : 1.5}
              fill={p.overflow ? '#ae8054' : '#607b47'}
            />
          ))}
          {currentPoint && (
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r="3"
              fill={Math.abs(current) > range ? '#ae8054' : '#506c39'}
            />
          )}
        </svg>
        {!samples.some((s) => s.cents !== null) && (
          <div className="history-empty">{t('拉奏后，这里会记录音准变化')}</div>
        )}
      </div>
      <div className="history-axis">
        <span>{t('6 秒前')}</span>
        <span>{t('3 秒前')}</span>
        <span>{listening ? t('现在') : t('最后记录')}</span>
      </div>
      <div className="history-stats">
        <span>
          {t('近 0.5 秒平均')}
          <b>
            {stats ? signed(stats.mean) : '—'} <small>{t('音分')}</small>
          </b>
        </span>
        <span>
          {t('波动')}
          <b>
            {stats ? `±${stats.deviation.toFixed(1)}` : '—'} <small>{t('音分')}</small>
          </b>
        </span>
      </div>
      <div className="stability-feedback" role="status" aria-live="polite" aria-atomic="true">
        <span className="feedback-icon">
          {success ? <Check size={17} /> : <span className="hold-dot" />}
        </span>
        <div>
          <b>{message}</b>
          <p>
            {success
              ? lang === 'zh'
                ? `已稳定保持 0.5 秒 · 平均 ${signed(success.mean)} 音分`
                : `Steady for 0.5s · Average ${signed(success.mean)} cents`
              : t('平均在 ±{cents} 音分内，稳定拉奏约 0.5 秒').replaceAll('{cents}', accuracyCents)}
          </p>
        </div>
        {success && (
          <button onClick={onReset} className="retry-tuning">
            <RotateCcw size={13} />
            {t('重新检测')}
          </button>
        )}
      </div>
      <div
        className="hold-progress"
        role="progressbar"
        aria-label={t('音准稳定进度')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((success ? 1 : progress) * 100)}
      >
        <span style={{ width: `${(success ? 1 : progress) * 100}%` }} />
      </div>
      <p className="history-footnote">
        {t(
          '短暂换弓可容忍；断音超过 0.3 秒重新累计。绿色带为 ±{cents} 音分准确区，量程固定 ±50 音分，超出部分在边缘用棕色标记。',
        ).replaceAll('{cents}', accuracyCents)}
      </p>
    </section>
  );
}
