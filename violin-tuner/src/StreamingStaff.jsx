import React, { memo, useCallback, useEffect, useRef } from 'react';
import { vibeXml } from './vibe.js';
let notationModule;
const loadNotation = () => (notationModule ||= import('opensheetmusicdisplay'));
// Spread independent engravings over frames so a four-bar burst does not monopolize the UI.
const engravingQueue = [];
function nextEngraving() {
  const work = engravingQueue.shift();
  work?.();
  if (engravingQueue.length) requestAnimationFrame(nextEngraving);
}
const scheduleEngraving = (work) =>
  new Promise((resolve, reject) => {
    engravingQueue.push(() => {
      try {
        resolve(work());
      } catch (error) {
        reject(error);
      }
    });
    if (engravingQueue.length === 1) requestAnimationFrame(nextEngraving);
  });
const StreamBar = memo(function StreamBar({ bar, bpm, first, previousKey, onTile }) {
  const host = useRef(null);
  useEffect(() => {
    const surface = host.current;
    let disposed = false,
      renderer;
    (async () => {
      try {
        const module = await loadNotation();
        if (disposed) return;
        const Constructor = module.OpenSheetMusicDisplay || module.default?.OpenSheetMusicDisplay;
        // Each immutable bar owns its renderer. Appending a bar never clears earlier SVGs.
        const staging = document.createElement('div');
        staging.className = 'stream-bar-surface';
        staging.style.visibility = 'hidden';
        staging.style.width = `${Math.max(200, bar.events.length * 32 + (first ? 120 : 24))}px`;
        surface.appendChild(staging);
        renderer = new Constructor(staging, {
          autoResize: false,
          disableCursor: false,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: '#b87a40', alpha: 0, follow: false }],
          backend: 'svg',
          renderSingleHorizontalStaffline: true,
          drawingParameters: 'compacttight',
          defaultColorMusic: '#887255',
          defaultColorNotehead: '#503c2a',
          defaultColorStem: '#604a33',
          defaultColorRest: '#786044',
          defaultColorLabel: '#8b7351',
          drawTitle: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: false,
          drawMetronomeMarks: false,
        });
        renderer.Zoom = 0.85;
        renderer.EngravingRules.RenderClefsAtBeginningOfStaffline = first;
        renderer.EngravingRules.RenderKeySignatures = first || bar.key !== previousKey;
        renderer.EngravingRules.RenderTimeSignatures = first;
        renderer.EngravingRules.PageLeftMargin = 0;
        renderer.EngravingRules.PageRightMargin = 0;
        const events = bar.events.map((e) => ({ ...e, beat: e.beat - bar.bar * 4 }));
        await renderer.load(vibeXml(events, bpm, '', bar.key || 'D', 4, bar.bar));
        if (disposed) return;
        renderer.Sheet.Repetitions = [];
        await scheduleEngraving(() => {
          if (!disposed) renderer.render();
        });
        if (disposed) return;
        const svg = staging.querySelector('svg');
        if (!svg) throw Error('Empty streamed score');
        // OSMD trims each page to its glyphs; align their staff lines to a shared baseline.
        const staffLine = Array.from(svg.querySelectorAll('path')).find(
          (path) =>
            path.getAttribute('stroke') === '#887255' &&
            path.getBoundingClientRect().width > 100 &&
            path.getBoundingClientRect().height < 2,
        );
        if (staffLine) {
          const top = staffLine.getBoundingClientRect().top - staging.getBoundingClientRect().top;
          staging.style.paddingTop = `${Math.max(0, 80 - top)}px`;
        }
        const width = svg.getBoundingClientRect().width;
        surface.style.width = `${Math.ceil(width)}px`;
        staging.style.width = `${Math.ceil(width)}px`;
        const cursor = renderer.cursor,
          anchors = [];
        cursor.reset();
        for (const beat of [...new Set([0, ...events.map((e) => e.beat)])]) {
          while (
            !cursor.Iterator.EndReached &&
            cursor.Iterator.CurrentSourceTimestamp.RealValue < beat / 4 - 0.00001
          )
            cursor.next();
          cursor.show();
          const mark = cursor.cursorElement;
          mark.classList.add('notation-native-cursor');
          mark.setAttribute('aria-hidden', 'true');
          const bounds = mark.getBoundingClientRect(),
            origin = staging.getBoundingClientRect();
          anchors.push({
            beat,
            x: bounds.left - origin.left,
            y: bounds.top - origin.top,
            height: bounds.height,
          });
        }
        staging.style.visibility = 'visible';
        onTile(bar.bar, {
          element: staging,
          anchors,
          hit(x, y) {
            const bounds = svg.getBoundingClientRect();
            if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)
              return null;
            const sheet = renderer.GraphicSheet,
              point = sheet.svgToOsmd(sheet.domToSvg({ x, y }));
            point.x /= renderer.Zoom;
            point.y /= renderer.Zoom;
            const entry = sheet.GetNearestVoiceEntry(point, true)?.parentStaffEntry;
            return entry ? entry.getAbsoluteTimestamp().RealValue * 4 : null;
          },
        });
      } catch (error) {
        if (!disposed) {
          console.error('Streamed bar rendering failed', error);
          onTile(bar.bar, null, error);
        }
      }
    })();
    return () => {
      disposed = true;
      onTile(bar.bar, null);
      renderer?.cursor?.Dispose();
      renderer?.clear();
      surface.replaceChildren();
    };
  }, [bar, bpm, first, previousKey, onTile]);
  return (
    <div
      className="stream-bar"
      data-stream-bar={bar.bar}
      ref={host}
      style={{ width: Math.max(200, bar.events.length * 32 + (first ? 120 : 24)) }}
    />
  );
});
export default function StreamingStaff({
  track,
  viewport,
  controller,
  latest,
  follow,
  onReady,
  onError,
}) {
  const root = useRef(null),
    tiles = useRef(new Map()),
    head = useRef(null),
    positionRef = useRef(null),
    last = useRef(null),
    settings = useRef(null);
  settings.current = { track, onReady, onError };
  const onTile = useCallback((bar, tile, error) => {
    if (tile) {
      tiles.current.set(bar, tile);
      settings.current.onReady();
      positionRef.current?.(true);
    } else tiles.current.delete(bar);
    if (error) settings.current.onError();
  }, []);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    function position(animate = true) {
      const score = settings.current.track,
        frame = viewport.current,
        surface = root.current;
      if (!frame || !surface) return;
      const beat = Math.max(0, Math.min(score.duration - 0.00001, latest.current.beat ?? 0)),
        absolute = beat + score.windowBeat;
      const tile = tiles.current.get(Math.floor(absolute / 4));
      if (!tile) return;
      const anchor =
        tile.anchors.findLast((a) => a.beat <= (absolute % 4) + 0.00001) || tile.anchors[0];
      if (!anchor?.height) return;
      const origin = surface.getBoundingClientRect(),
        bounds = tile.element.getBoundingClientRect();
      const x = bounds.left - origin.left + anchor.x,
        y = bounds.top - origin.top + anchor.y;
      const glide = animate && last.current && !reduced.matches;
      head.current.style.transition = glide
        ? `transform ${Math.min(480, Math.max(100, latest.current.noteDuration * 850))}ms cubic-bezier(.25,.75,.25,1)`
        : 'none';
      head.current.style.height = `${anchor.height}px`;
      head.current.style.transform = `translate3d(${x}px,${y}px,0)`;
      last.current = { x, y };
      if (follow.current) {
        const left = Math.max(
          0,
          Math.min(frame.scrollWidth - frame.clientWidth, x - frame.clientWidth * 0.32),
        );
        frame.scrollTo({ left, behavior: animate && !reduced.matches ? 'smooth' : 'instant' });
      }
    }
    positionRef.current = position;
    controller.current = {
      position,
      hit(x, y) {
        const score = settings.current.track;
        for (const [bar, tile] of tiles.current) {
          const beat = tile.hit(x, y);
          if (beat !== null) return bar * 4 - score.windowBeat + beat;
        }
        return null;
      },
    };
    const observer = new ResizeObserver(() => position(false));
    observer.observe(viewport.current);
    position(false);
    return () => {
      observer.disconnect();
      controller.current = null;
      positionRef.current = null;
    };
  }, [controller, viewport, latest, follow]);
  return (
    <div ref={root} className="notation-stream">
      {track.streamBars.map((bar, index) => (
        <StreamBar
          key={bar.bar}
          bar={bar}
          bpm={track.bpm}
          first={index === 0}
          previousKey={track.streamBars[index - 1]?.key}
          onTile={onTile}
        />
      ))}
      <div ref={head} className="notation-playhead" aria-hidden="true" />
    </div>
  );
}
