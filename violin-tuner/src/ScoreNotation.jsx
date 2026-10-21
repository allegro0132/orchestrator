import React, { useEffect, useRef, useState } from 'react';
import { excerptXml } from './score.js';
import { useLanguage } from './i18n.jsx';
let notationModule;
const loadNotation = () => (notationModule ||= import('opensheetmusicdisplay'));
export default function ScoreNotation({ track, measure, full, beat }) {
  const host = useRef(null),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true);
  const { t } = useLanguage();
  const drawn = useRef(null),
    beatRef = useRef(beat);
  beatRef.current = beat;
  function syncCursor(renderer) {
    if (!renderer?.cursor || full) return;
    const start = Math.max(0, measure - 1);
    const target =
      Math.max(0, (beatRef.current ?? track.measures[measure].beat) - track.measures[start].beat) /
      4;
    const cursor = renderer.cursor;
    cursor.reset();
    let steps = 0;
    while (
      !cursor.Iterator.EndReached &&
      cursor.Iterator.CurrentSourceTimestamp.RealValue < target - 0.0001 &&
      steps++ < 2048
    )
      cursor.next();
    cursor.show();
    const frame = host.current?.parentElement,
      mark = cursor.cursorElement;
    if (frame && mark) {
      const bounds = frame.getBoundingClientRect(),
        position = mark.getBoundingClientRect();
      if (position.top < bounds.top || position.bottom > bounds.bottom)
        frame.scrollTop += position.top - bounds.top - frame.clientHeight * 0.3;
    }
  }
  useEffect(() => {
    syncCursor(drawn.current);
  }, [beat, full]);
  useEffect(() => {
    let disposed = false,
      renderer;
    const observer = new ResizeObserver(() => {
      if (renderer && !disposed && !loadingScore) {
        renderer.render();
        syncCursor(renderer);
      }
    });
    let loadingScore = true;
    setLoading(true);
    setFailed(false);
    const container = document.createElement('div');
    host.current.replaceChildren(container);
    (async () => {
      try {
        const module = await loadNotation();
        if (disposed) return;
        const Constructor = module.OpenSheetMusicDisplay || module.default?.OpenSheetMusicDisplay;
        renderer = new Constructor(container, {
          autoResize: false,
          disableCursor: false,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: '#90a56b', alpha: 0.4, follow: false }],
          backend: 'svg',
          drawingParameters: 'compacttight',
          drawTitle: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawMetronomeMarks: false,
        });
        renderer.Zoom = 0.85;
        await renderer.load(excerptXml(track, measure, full));
        if (disposed) return;
        renderer.render();
        drawn.current = renderer;
        syncCursor(renderer);
        loadingScore = false;
        observer.observe(container);
        setLoading(false);
      } catch (error) {
        console.error('Score notation rendering failed', error);
        if (!disposed) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
      drawn.current = null;
      renderer?.cursor?.Dispose();
      observer.disconnect();
      renderer?.clear();
      renderer?.setOptions({ autoResize: false });
    };
  }, [track, measure, full]);
  return (
    <div className="notation-frame" aria-busy={loading}>
      {loading && <p className="notation-message">{t('正在排版曲谱…')}</p>}
      {failed && (
        <p className="error" role="alert">
          {t('谱面排版失败，仍可使用下方音符和实时分析。')}
        </p>
      )}
      <div ref={host} className="notation" aria-label={t('五线谱')} />
    </div>
  );
}
