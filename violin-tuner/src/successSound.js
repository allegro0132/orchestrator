// A short rising chime, using the AudioContext unlocked by Enable microphone.
// Return the duration so target switching can ignore speaker feedback.
export function playSuccessSound(context) {
  if (!context || context.state !== 'running') return 0;
  try {
    const start = context.currentTime;
    for (const [frequency, offset] of [
      [1046.5, 0],
      [1318.5, 0.12],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.07, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.28);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.3);
    }
    return 0.42;
  } catch {
    // Audio playback must never interrupt pitch detection or visual feedback.
    return 0;
  }
}
