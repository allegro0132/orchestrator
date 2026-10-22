import { useEffect, useState } from 'react';

// Keep the existing score and audio session mounted in both native and CSS fullscreen.
export default function useScoreFullscreen(frame) {
  const [expanded, setExpanded] = useState(false);
  function close() {
    setExpanded(false);
    if (document.fullscreenElement === frame.current) document.exitFullscreen().catch(() => {});
  }
  async function toggle() {
    if (expanded) return close();
    setExpanded(true);
    try {
      if (document.fullscreenEnabled && frame.current?.requestFullscreen)
        await frame.current.requestFullscreen();
    } catch {
      // Mobile browsers and embedded views can use the same layout without the API.
    }
  }
  useEffect(() => {
    function changed() {
      setExpanded(document.fullscreenElement === frame.current);
    }
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const surface = frame.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    surface.querySelector('[data-fullscreen-toggle]')?.focus({ preventScroll: true });
    function keydown(event) {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...surface.querySelectorAll(
          'button:not(:disabled), [tabindex="0"], select:not(:disabled), a[href]',
        ),
      ].filter((item) => item.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (
        !surface.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    }
    const keyup = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      if (document.fullscreenElement === surface) document.exitFullscreen().catch(() => {});
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded]);
  return { expanded, toggle };
}
