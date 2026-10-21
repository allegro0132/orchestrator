import React, { useState } from 'react';
import { BookOpen, ChevronDown, ArrowUpRight, Check } from 'lucide-react';
import { useLanguage } from './i18n.jsx';
import { SCORE_LIBRARY, SCORE_LEVELS } from './scoreLibrary.js';

export function ScoreAttribution({ item }) {
  const { lang } = useLanguage();
  const text = (zh, en) => (lang === 'zh' ? zh : en);
  return (
    <aside className="score-attribution">
      <p>{item.edition[lang]}</p>
      <p>
        {text('来源及制谱', 'Source & engraving')}:{' '}
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
          Mutopia · {item.credit}
        </a>
        {' · '}
        <a href={item.licenseUrl} target="_blank" rel="noreferrer">
          {item.license}
        </a>
        {' · '}
        <a href={`${import.meta.env.BASE_URL}scores/${item.id}.musicxml`} download>
          {text('下载 MusicXML', 'Download MusicXML')}
        </a>
      </p>
    </aside>
  );
}
export default function ScoreLibrary({ open, onToggle, onSelect, selectedId, disabled, loading }) {
  const { lang } = useLanguage();
  const text = (zh, en) => (lang === 'zh' ? zh : en);
  const [level, setLevel] = useState('all');
  const items = SCORE_LIBRARY.filter((item) => level === 'all' || item.level === level);
  return (
    <section className="score-library" aria-label={text('预置曲库', 'Score library')}>
      <button
        className="library-toggle"
        aria-expanded={open}
        aria-controls="score-library-content"
        onClick={onToggle}
        disabled={disabled}
      >
        <BookOpen size={18} />
        <span>
          {text('预置曲库', 'Score library')}
          <small>{text('6 首开放曲谱 · 按难度选曲', '6 open scores · find your next piece')}</small>
        </span>
        <ChevronDown size={18} className={open ? 'expanded' : ''} />
      </button>
      {open && (
        <div id="score-library-content" className="library-content">
          <div
            className="library-filters"
            role="group"
            aria-label={text('曲谱难度', 'Score difficulty')}
          >
            {[{ id: 'all', title: { zh: '全部', en: 'All levels' } }, ...SCORE_LEVELS].map(
              (option) => (
                <button
                  key={option.id}
                  aria-pressed={level === option.id}
                  onClick={() => setLevel(option.id)}
                  disabled={disabled}
                >
                  {option.title[lang]}
                </button>
              ),
            )}
          </div>
          <p className="library-intro">
            {text(
              '按当前练习版本的音域、节奏与换弦难度分级，不对应考级等级。点击曲目即可跟谱练习，也可自行导入。',
              'Levels reflect the range, rhythm and string crossings of these practice editions, not exam grades. Choose a piece or import your own.',
            )}
          </p>
          <div className="library-grid">
            {items.map((item) => (
              <article
                className={'library-card' + (selectedId === item.id ? ' selected' : '')}
                key={item.id}
              >
                <div className="library-card-top">
                  <span>{SCORE_LEVELS.find((l) => l.id === item.level).title[lang]}</span>
                  <small>{item.bpm} BPM</small>
                </div>
                <h3>{item.title[lang]}</h3>
                <p className="library-composer">{item.composer}</p>
                <p className="library-focus">{item.focus[lang]}</p>
                <div className="library-card-meta">
                  {item.key} · {item.bars} {text('小节', 'bars')}
                </div>
                <details>
                  <summary>{text('版本与许可', 'Edition & license')}</summary>
                  <ScoreAttribution item={item} />
                </details>
                <button className="library-play" disabled={disabled} onClick={() => onSelect(item)}>
                  {selectedId === item.id ? <Check size={15} /> : <ArrowUpRight size={15} />}
                  {loading === item.id
                    ? text('正在加载…', 'Loading…')
                    : selectedId === item.id
                      ? text('重新练习', 'Practice again')
                      : text('练习这首', 'Practice this piece')}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
