export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const METERS = [1, 2, 3, 4, 6];
export function normalizeMetronome(settings = {}) {
  return {
    bpm: Number.isFinite(settings.bpm)
      ? Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(settings.bpm)))
      : 80,
    beats: METERS.includes(settings.beats) ? settings.beats : 4,
    volume: Number.isFinite(settings.volume) ? Math.max(0, Math.min(100, settings.volume)) : 40,
    accent: typeof settings.accent === 'boolean' ? settings.accent : true,
  };
}

// Schedule sound against the audio clock, ahead of UI timers, to avoid tempo drift.
export function createMetronome(
  context,
  {
    onBeat = () => {},
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  let options = normalizeMetronome(),
    running = false,
    timer = null,
    nextTime = 0,
    beat = 0;
  const nodes = new Set(),
    visuals = new Set();
  function schedule(time, index) {
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = options.accent && index === 0 ? 1400 : 900;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime((options.volume / 100) * 0.18, time + 0.002);
    if (options.volume > 0) gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    else gain.gain.linearRampToValueAtTime(0, time + 0.035);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const node = { oscillator, gain };
    nodes.add(node);
    oscillator.onended = () => {
      nodes.delete(node);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(time);
    oscillator.stop(time + 0.04);
    const visual = setTimeoutFn(
      () => {
        visuals.delete(visual);
        if (running) onBeat(index);
      },
      Math.max(0, (time - context.currentTime) * 1000),
    );
    visuals.add(visual);
  }
  function pump() {
    if (!running || context.state !== 'running') return;
    const interval = 60 / options.bpm;
    // Skip missed beats after a stalled timer rather than playing a burst.
    if (nextTime < context.currentTime - 0.02) {
      const missed = Math.ceil((context.currentTime - nextTime) / interval);
      nextTime += missed * interval;
      beat = (beat + missed) % options.beats;
    }
    while (nextTime < context.currentTime + 0.1) {
      schedule(nextTime, beat);
      nextTime += interval;
      beat = (beat + 1) % options.beats;
    }
  }
  function stop() {
    running = false;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    for (const visual of visuals) clearTimeoutFn(visual);
    visuals.clear();
    for (const { oscillator, gain } of nodes) {
      try {
        oscillator.stop();
      } catch {}
      oscillator.disconnect();
      gain.disconnect();
    }
    nodes.clear();
  }
  function start(settings) {
    stop();
    options = normalizeMetronome(settings);
    running = true;
    beat = 0;
    nextTime = context.currentTime + 0.04;
    pump();
    timer = setIntervalFn(pump, 25);
  }
  function update(settings) {
    const next = normalizeMetronome(settings);
    if (running && (next.bpm !== options.bpm || next.beats !== options.beats)) start(next);
    else options = next;
  }
  return { start, stop, update };
}
