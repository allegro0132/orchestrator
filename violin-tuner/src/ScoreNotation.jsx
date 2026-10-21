import React, { useEffect, useRef, useState } from 'react';
import { excerptXml } from './score.js';
import { useLanguage } from './i18n.jsx';
let notationModule;
const loadNotation = () => (notationModule ||= import('opensheetmusicdisplay'));

export default function ScoreNotation({
  track,
  measure,
  full,
  beat,
  noteDuration = 0.5,
  playing = false,
}) {
  const host = useRef(null),
    controller = useRef(null);
  const latest = useRef({ measure, beat, noteDuration });
  latest.current = { measure, beat, noteDuration };
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const { t, lang } = useLanguage();

  useEffect(() => {
    const surface = host.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const entries = new Map();
    let disposed = false,
      active = null,
      request = 0,
      width = surface.clientWidth;
    let idle = null,
      resizeTimer = null;
    setLoading(true);
    setFailed(false);

    function remove(entry) {
      if (!entry || entry.disposed) return;
      entry.disposed = true;
      clearTimeout(entry.retire);
      entry.node.getAnimations().forEach((animation) => animation.cancel());
      entry.renderer?.cursor?.Dispose();
      entry.renderer?.clear();
      entry.node.remove();
      entries.delete(entry.key);
    }
    function trim(keep) {
      for (const entry of entries.values()) if (!keep.includes(entry)) remove(entry);
    }
    function position(entry, animate = true) {
      const cursor = entry?.renderer?.cursor;
      if (!cursor || full || !entry.ready) return;
      const { beat, noteDuration } = latest.current;
      const start = Math.max(0, entry.measure - 1);
      const target =
        Math.max(0, (beat ?? track.measures[entry.measure].beat) - track.measures[start].beat) / 4;
      let anchor = entry.anchors.get(target);
      if (!anchor) {
        cursor.reset();
        let steps = 0;
        while (
          !cursor.Iterator.EndReached &&
          cursor.Iterator.CurrentSourceTimestamp.RealValue < target - 0.0001 &&
          steps++ < 2048
        )
          cursor.next();
        cursor.show();
        const mark = cursor.cursorElement;
        mark.classList.add('notation-native-cursor');
        mark.setAttribute('aria-hidden', 'true');
        const parent = mark.parentElement;
        const bounds = mark.getBoundingClientRect(),
          origin = parent.getBoundingClientRect();
        anchor = {
          x: bounds.left - origin.left,
          y: bounds.top - origin.top,
          height: bounds.height,
          parent,
        };
        entry.anchors.set(target, anchor);
      }
      if (!anchor.height) return;
      if (!entry.playhead) {
        entry.playhead = document.createElement('div');
        entry.playhead.className = 'notation-playhead';
        entry.playhead.setAttribute('aria-hidden', 'true');
      }
      const playhead = entry.playhead;
      if (playhead.parentElement !== anchor.parent) anchor.parent.appendChild(playhead);
      const changedRow = entry.anchor && Math.abs(anchor.y - entry.anchor.y) > anchor.height * 0.5;
      const glide = animate && entry.anchor && !changedRow && !media.matches;
      const motion = `transform ${Math.min(480, Math.max(100, noteDuration * 850))}ms cubic-bezier(.25,.75,.25,1)`;
      const viewport = surface.clientWidth - 16;
      const shift = Math.max(0, anchor.x - Math.max(86, viewport * 0.32));
      entry.node.style.transition = glide ? motion : 'none';
      entry.node.style.transform = `translate3d(${-shift}px,0,0)`;
      playhead.style.transition = glide ? `${motion}, height 180ms ease` : 'none';
      playhead.style.height = `${anchor.height}px`;
      playhead.style.transform = `translate3d(${anchor.x}px,${anchor.y}px,0)`;
      if (changedRow && animate && !media.matches) {
        playhead.getAnimations().forEach((animation) => animation.cancel());
        playhead.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }
      entry.anchor = anchor;
      // Scroll only the notation viewport; page position stays under the player's control.
      const frame = surface.parentElement;
      const top =
        anchor.parent.getBoundingClientRect().top +
        anchor.y -
        frame.getBoundingClientRect().top +
        frame.scrollTop;
      if (
        top < frame.scrollTop + 8 ||
        top + anchor.height > frame.scrollTop + frame.clientHeight - 8
      ) {
        frame.scrollTo({
          top: Math.max(0, top - frame.clientHeight * 0.25),
          behavior: animate && !media.matches ? 'smooth' : 'instant',
        });
      }
    }
    function build(at) {
      const key = `${at}:${width}`;
      if (entries.has(key)) return entries.get(key);
      const node = document.createElement('div');
      node.className = 'notation-layer';
      node.setAttribute('aria-hidden', 'true');
      surface.appendChild(node);
      const entry = { key, measure: at, node, anchors: new Map() };
      entries.set(key, entry);
      entry.promise = (async () => {
        const module = await loadNotation();
        if (disposed || entry.disposed) return null;
        const Constructor = module.OpenSheetMusicDisplay || module.default?.OpenSheetMusicDisplay;
        entry.renderer = new Constructor(node, {
          autoResize: false,
          disableCursor: false,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: '#90a56b', alpha: 0, follow: false }],
          backend: 'svg',
          renderSingleHorizontalStaffline: !full,
          defaultColorMusic: '#887255',
          defaultColorNotehead: '#503c2a',
          defaultColorStem: '#604a33',
          defaultColorRest: '#786044',
          defaultColorLabel: '#8b7351',
          drawingParameters: 'compacttight',
          drawTitle: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawMetronomeMarks: false,
        });
        entry.renderer.Zoom = 0.85;
        await entry.renderer.load(excerptXml(track, at, full));
        if (disposed || entry.disposed) return null;
        entry.renderer.render();
        entry.ready = true;
        return entry;
      })();
      return entry;
    }
    function prefetch(at) {
      clearTimeout(idle);
      if (full || at + 1 >= track.measures.length) return;
      // Prepare the following neighborhood between bar changes, never during a cursor update.
      idle = setTimeout(() => {
        const next = build(at + 1);
        next.promise.catch(() => remove(next));
      }, 180);
    }
    async function show(at) {
      const token = ++request;
      const entry = build(at);
      try {
        await entry.promise;
        if (disposed || entry.disposed || token !== request) return;
        if (active === entry) {
          position(entry);
          return;
        }
        const previous = active;
        active = entry;
        clearTimeout(entry.retire);
        const height = full
          ? Math.max(155, entry.node.offsetHeight + 16)
          : Math.max(180, entry.node.offsetHeight + 72);
        surface.style.height = `${height}px`;
        position(entry, false);
        entry.node.style.opacity = '1';
        entry.node.setAttribute('aria-hidden', 'false');
        if (previous) {
          previous.node.setAttribute('aria-hidden', 'true');
          if (!media.matches) {
            entry.node.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 180,
              easing: 'ease-out',
            });
            previous.node.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: 160,
              easing: 'ease-out',
            });
          }
          previous.node.style.opacity = '0';
          previous.retire = setTimeout(
            () => {
              if (active !== previous) remove(previous);
            },
            media.matches ? 0 : 280,
          );
        } else if (!media.matches) {
          entry.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 220,
            easing: 'ease-out',
          });
        }
        const next = entries.get(`${at + 1}:${width}`);
        trim([entry, previous, next]);
        setLoading(false);
        setFailed(false);
        prefetch(at);
      } catch (error) {
        if (disposed || token !== request) return;
        remove(entry);
        console.error('Score notation rendering failed', error);
        setLoading(false);
        setFailed(true);
      }
    }
    controller.current = { show, position: () => position(active) };
    show(latest.current.measure);
    const observer = new ResizeObserver(() => {
      const next = surface.clientWidth;
      if (Math.abs(next - width) < 1) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        width = surface.clientWidth;
        show(latest.current.measure);
      }, 120);
    });
    observer.observe(surface);
    return () => {
      disposed = true;
      request++;
      controller.current = null;
      clearTimeout(idle);
      clearTimeout(resizeTimer);
      observer.disconnect();
      for (const entry of entries.values()) remove(entry);
      surface.style.height = '';
    };
  }, [track, full]);
  useEffect(() => {
    controller.current?.show(measure);
  }, [measure]);
  useEffect(() => {
    controller.current?.position();
  }, [beat, noteDuration]);
  return (
    <div
      className={'notation-frame' + (full ? ' is-full' : '') + (playing ? ' is-following' : '')}
      aria-busy={loading}
    >
      <div className="notation-toolbar">
        <span>
          <i />
          {lang === 'zh' ? '流动谱面' : 'SCORE FLOW'}
        </span>
        <span>
          {full
            ? lang === 'zh'
              ? '完整曲谱'
              : 'FULL SCORE'
            : playing
              ? lang === 'zh'
                ? '正在跟随'
                : 'FOLLOWING'
              : lang === 'zh'
                ? '准备演奏'
                : 'READY'}
          <b>
            {String(measure + 1).padStart(2, '0')}
            <em> / {String(track.measures.length).padStart(2, '0')}</em>
          </b>
        </span>
      </div>
      {loading && <p className="notation-message">{t('正在排版曲谱…')}</p>}
      {failed && (
        <p className="error" role="alert">
          {t('谱面排版失败，仍可使用下方音符和实时分析。')}
        </p>
      )}
      <div ref={host} className="notation" aria-label={t('五线谱')} />
      <div className="notation-flow-rail" aria-hidden="true">
        <i style={{ width: `${((measure + 1) / track.measures.length) * 100}%` }} />
      </div>
    </div>
  );
}
