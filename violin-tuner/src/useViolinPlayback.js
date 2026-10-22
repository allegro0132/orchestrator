import { useEffect, useRef, useState } from 'react';
import { violinInstrument, createViolinTransport } from './violinAudio.js';
export default function useViolinPlayback(getAudioContext, { onTime, onEnd } = {}) {
  const [status, setStatus] = useState('idle'),
    [error, setError] = useState(false),
    [time, setTime] = useState(0);
  const state = useRef({ token: 0 }),
    latest = useRef(null);
  latest.current = { getAudioContext, onTime, onEnd };
  const publish = (value) => {
    setTime(value);
    latest.current.onTime?.(value);
  };
  function stop(update = true) {
    const run = state.current;
    run.token++;
    cancelAnimationFrame(run.frame);
    run.transport?.stop();
    run.transport = null;
    if (update) {
      setStatus('idle');
      setTime(0);
    }
  }
  function pause() {
    const run = state.current;
    run.token++;
    cancelAnimationFrame(run.frame);
    if (run.transport) publish(run.transport.pause());
    setStatus(run.transport ? 'paused' : 'idle');
  }
  async function play(events, duration, reference, at = 0) {
    stop(false);
    const run = state.current,
      token = run.token;
    setError(false);
    setStatus('loading');
    try {
      const context = await latest.current.getAudioContext();
      const instrument = violinInstrument(context);
      await instrument.prepare(events.filter((e) => e.end > at).map((e) => e.midi));
      if (token !== run.token) return;
      const transport = createViolinTransport(context, instrument, events, duration, reference, {
        onEnd: () => {
          if (token !== run.token) return;
          cancelAnimationFrame(run.frame);
          publish(duration);
          setStatus('ended');
          latest.current.onEnd?.();
        },
      });
      run.transport = transport;
      transport.play(at);
      publish(at);
      setStatus(at >= duration ? 'ended' : 'playing');
      let lastPaint = -Infinity;
      const tick = (stamp) => {
        if (token !== run.token) return;
        if (stamp - lastPaint >= 65) {
          publish(transport.position());
          lastPaint = stamp;
        }
        run.frame = requestAnimationFrame(tick);
      };
      if (at < duration) run.frame = requestAnimationFrame(tick);
    } catch {
      if (token === run.token) {
        stop();
        setError(true);
      }
    }
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) pause();
    };
    const leave = () => pause();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      stop(false);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    };
  }, []);
  return {
    status,
    error,
    time,
    play,
    pause,
    stop,
    playing: status === 'playing',
    loading: status === 'loading',
  };
}
