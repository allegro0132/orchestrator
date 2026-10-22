import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LocateFixed, Maximize2, Minimize2 } from 'lucide-react';
import useScoreFullscreen from './useScoreFullscreen.jsx';
import { excerptXml } from './score.js';
import { useLanguage } from './i18n.jsx';
let notationModule;
const loadNotation = () => (notationModule ||= import('opensheetmusicdisplay'));

export default function ScoreNotation({
  track,
  measure,
  beat,
  noteDuration = 0.5,
  playing = false,
  renderOverlay,
  action,
  onSeek,
  measureNumber,
  totalMeasures,
}) {
  const frame = useRef(null);
  const overlay = useRef(null);
  const { expanded, toggle } = useScoreFullscreen(frame);
  const host = useRef(null),
    viewport = useRef(null),
    controller = useRef(null);
  const latest = useRef({ measure, beat, noteDuration, playing });
  latest.current = { measure, beat, noteDuration, playing };
  const follow = useRef(true),
    drag = useRef(null);
  const touch = useRef(null),
    lastTap = useRef(null),
    lastSeek = useRef(0);
  const [following, setFollowing] = useState(true),
    [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const { lang, t } = useLanguage();
  const text = (zh, en) => (lang === 'zh' ? zh : en);
  useEffect(() => {
    if (!overlay.current) return;
    const observer = new ResizeObserver(([entry]) => {
      frame.current?.style.setProperty(
        '--hud-height',
        `${entry.target.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(overlay.current);
    return () => observer.disconnect();
  }, [!!renderOverlay]);
  function browse() {
    follow.current = false;
    setFollowing(false);
  }
  function followCurrent() {
    follow.current = true;
    setFollowing(true);
    controller.current?.position(true);
  }
  function move(direction) {
    browse();
    viewport.current.scrollBy({
      left: direction * viewport.current.clientWidth * 0.65,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }
  useEffect(() => {
    const surface = host.current,
      frame = viewport.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false,
      renderer,
      playhead,
      previous = null;
    const anchors = new Map();
    setLoading(true);
    setFailed(false);
    follow.current = true;
    setFollowing(true);
    frame.scrollLeft = 0;
    surface.style.width = `${Math.max(480, frame.clientWidth)}px`;
    function position(animate = true) {
      const cursor = renderer?.cursor;
      if (disposed || !cursor || !playhead) return;
      const { beat, measure, noteDuration } = latest.current;
      const target = Math.max(0, beat ?? track.measures[measure].beat) / 4;
      let anchor = anchors.get(target);
      if (!anchor) {
        if (cursor.Iterator.EndReached || cursor.Iterator.CurrentSourceTimestamp.RealValue > target)
          cursor.reset();
        let steps = 0;
        while (
          !cursor.Iterator.EndReached &&
          cursor.Iterator.CurrentSourceTimestamp.RealValue < target - 0.0001 &&
          steps++ < 100000
        )
          cursor.next();
        cursor.show();
        const mark = cursor.cursorElement;
        mark.classList.add('notation-native-cursor');
        mark.setAttribute('aria-hidden', 'true');
        const parent = mark.parentElement,
          bounds = mark.getBoundingClientRect(),
          origin = parent.getBoundingClientRect();
        anchor = {
          x: bounds.left - origin.left,
          y: bounds.top - origin.top,
          height: bounds.height,
          parent,
        };
        anchors.set(target, anchor);
      }
      if (!anchor.height) return;
      if (playhead.parentElement !== anchor.parent) anchor.parent.appendChild(playhead);
      const glide = animate && previous && !media.matches;
      playhead.style.transition = glide
        ? `transform ${Math.min(480, Math.max(100, noteDuration * 850))}ms cubic-bezier(.25,.75,.25,1),height 180ms ease`
        : 'none';
      playhead.style.height = `${anchor.height}px`;
      playhead.style.transform = `translate3d(${anchor.x}px,${anchor.y}px,0)`;
      previous = anchor;
      if (follow.current) {
        const x =
          anchor.parent.getBoundingClientRect().left -
          frame.getBoundingClientRect().left +
          frame.scrollLeft +
          anchor.x;
        const left = Math.max(
          0,
          Math.min(frame.scrollWidth - frame.clientWidth, x - frame.clientWidth * 0.32),
        );
        frame.scrollTo({ left, behavior: animate && !media.matches ? 'smooth' : 'instant' });
      }
    }
    (async () => {
      try {
        const module = await loadNotation();
        if (disposed) return;
        const Constructor = module.OpenSheetMusicDisplay || module.default?.OpenSheetMusicDisplay;
        renderer = new Constructor(surface, {
          autoResize: false,
          disableCursor: false,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: '#b87a40', alpha: 0, follow: false }],
          backend: 'svg',
          renderSingleHorizontalStaffline: true,
          defaultColorMusic: '#887255',
          defaultColorNotehead: '#503c2a',
          defaultColorStem: '#604a33',
          defaultColorRest: '#786044',
          defaultColorLabel: '#8b7351',
          drawingParameters: 'compacttight',
          drawTitle: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: false,
          drawMetronomeMarks: false,
        });
        renderer.Zoom = 0.85;
        await renderer.load(excerptXml(track, 0, true));
        if (disposed) return;
        // Analysis follows written order. Keep repeat symbols visible without replaying cursor entries.
        renderer.Sheet.Repetitions = [];
        renderer.render();
        renderer.cursor.reset();
        const width = Math.max(
          0,
          ...Array.from(surface.querySelectorAll('svg')).map(
            (svg) => svg.getBoundingClientRect().width,
          ),
        );
        surface.style.width = `${Math.ceil(width) + 16}px`;
        surface.style.minHeight = `${Math.max(180, surface.scrollHeight)}px`;
        playhead = document.createElement('div');
        playhead.className = 'notation-playhead';
        playhead.setAttribute('aria-hidden', 'true');
        controller.current = {
          position,
          hit(clientX, clientY) {
            const svg = surface.querySelector('svg');
            if (!svg) return null;
            const bounds = svg.getBoundingClientRect();
            if (
              clientY < bounds.top ||
              clientY > bounds.bottom ||
              clientX < bounds.left ||
              clientX > bounds.right
            )
              return null;
            // Convert screen coordinates through the SVG matrix, then undo engraving zoom.
            const sheet = renderer.GraphicSheet;
            const point = sheet.svgToOsmd(sheet.domToSvg({ x: clientX, y: clientY }));
            point.x /= renderer.Zoom;
            point.y /= renderer.Zoom;
            const entry = sheet.GetNearestVoiceEntry(point, true)?.parentStaffEntry;
            return entry ? entry.getAbsoluteTimestamp().RealValue * 4 : null;
          },
        };
        position(false);
        setLoading(false);
        if (!media.matches)
          surface.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      } catch (error) {
        if (disposed) return;
        console.error('Score notation rendering failed', error);
        setLoading(false);
        setFailed(true);
      }
    })();
    const observer = new ResizeObserver(() => {
      if (follow.current) position(false);
    });
    observer.observe(frame);
    return () => {
      disposed = true;
      controller.current = null;
      observer.disconnect();
      surface.getAnimations().forEach((a) => a.cancel());
      playhead?.remove();
      renderer?.cursor?.Dispose();
      renderer?.clear();
      surface.replaceChildren();
      surface.style.width = '';
      surface.style.minHeight = '';
    };
  }, [track]);
  useEffect(() => {
    controller.current?.position();
  }, [beat, noteDuration, measure]);
  useEffect(() => {
    if (playing) followCurrent();
  }, [playing]);
  // A paused bar selection is an explicit request to navigate to that note.
  useEffect(() => {
    if (!playing) followCurrent();
  }, [measure]);
  function pointerDown(e) {
    browse();
    if (e.pointerType === 'touch') {
      touch.current = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function pointerMove(e) {
    if (touch.current && Math.hypot(e.clientX - touch.current.x, e.clientY - touch.current.y) > 10)
      touch.current.moved = true;
    if (!drag.current || drag.current.id !== e.pointerId) return;
    e.currentTarget.scrollLeft = drag.current.left + drag.current.x - e.clientX;
  }
  function pointerUp(e) {
    if (e.pointerType === 'touch') {
      if (touch.current && !touch.current.moved) {
        const now = Date.now(),
          previous = lastTap.current;
        if (
          previous &&
          now - previous.time < 350 &&
          Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 24
        ) {
          activate(e);
          lastTap.current = null;
        } else lastTap.current = { time: now, x: e.clientX, y: e.clientY };
      } else lastTap.current = null;
      touch.current = null;
      return;
    }
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function activate(e) {
    if (!onSeek || Date.now() - lastSeek.current < 400) return;
    const target = controller.current?.hit(e.clientX, e.clientY);
    if (!Number.isFinite(target)) return;
    lastSeek.current = Date.now();
    follow.current = true;
    setFollowing(true);
    onSeek(target);
  }
  function keyDown(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    browse();
    if (e.key === 'Home' || e.key === 'End')
      e.currentTarget.scrollTo({
        left: e.key === 'Home' ? 0 : e.currentTarget.scrollWidth,
        behavior: 'instant',
      });
    else move(e.key === 'ArrowLeft' ? -1 : 1);
  }
  return (
    <div
      ref={frame}
      className={
        'notation-frame' +
        (playing && following ? ' is-following' : '') +
        (expanded ? ' is-expanded' : '')
      }
      aria-busy={loading}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? text('全屏曲谱', 'Fullscreen score') : undefined}
    >
      <div className="notation-toolbar">
        <span>
          <i />
          {text('完整曲谱', 'FULL SCORE')}
        </span>
        <span>
          {!following
            ? text('自由浏览', 'BROWSING')
            : playing
              ? text('正在跟随', 'FOLLOWING')
              : text('准备演奏', 'READY')}
          <b>
            {String(measureNumber ?? measure + 1).padStart(2, '0')}
            <em> / {String(totalMeasures ?? track.measures.length).padStart(2, '0')}</em>
          </b>
        </span>
        <button
          className="notation-expand"
          type="button"
          data-fullscreen-toggle
          aria-label={
            expanded ? text('退出全屏', 'Exit fullscreen') : text('全屏谱面', 'Fullscreen score')
          }
          aria-pressed={expanded}
          onClick={toggle}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          <span>{expanded ? text('退出全屏', 'Exit fullscreen') : text('全屏', 'Fullscreen')}</span>
        </button>
      </div>
      {loading && <p className="notation-message">{t('正在排版曲谱…')}</p>}
      {failed && (
        <p className="error" role="alert">
          {t('谱面排版失败，仍可使用下方音符和实时分析。')}
        </p>
      )}
      {action && <div className="notation-action">{action}</div>}
      <div className="notation-stage">
        <div
          ref={viewport}
          className={'notation-viewport' + (dragging ? ' dragging' : '')}
          role="region"
          tabIndex={0}
          aria-label={text(
            '完整曲谱，可左右滑动或使用方向键浏览',
            'Full score. Swipe, drag, or use arrow keys to browse.',
          )}
          onPointerDown={pointerDown}
          onDoubleClick={activate}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={(e) => {
            touch.current = null;
            lastTap.current = null;
            pointerUp(e);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onWheel={browse}
          onKeyDown={keyDown}
        >
          <div ref={host} className="notation" aria-label={t('五线谱')} />
        </div>
        {renderOverlay && (
          <div className="notation-overlay" ref={overlay}>
            {renderOverlay({ expanded })}
          </div>
        )}
      </div>
      <div className="notation-navigation">
        <span>
          {onSeek
            ? text(
                '双击音符开始 / 继续 · 左右滑动浏览',
                'Double-click a note to play · swipe or drag to browse',
              )
            : text('左右滑动或拖动，浏览曲谱', 'Swipe or drag to explore the score')}
        </span>
        <div>
          <button
            type="button"
            disabled={loading || failed}
            aria-label={text('向左浏览曲谱', 'Scroll score left')}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            disabled={loading || failed}
            aria-label={text('向右浏览曲谱', 'Scroll score right')}
            onClick={() => move(1)}
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className={'notation-follow' + (!following ? ' available' : '')}
            disabled={loading || failed}
            aria-label={text('回到当前音符并自动跟随', 'Return to the current note and follow')}
            onClick={followCurrent}
          >
            <LocateFixed size={14} />
            <span>{text('回到当前', 'Follow note')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
