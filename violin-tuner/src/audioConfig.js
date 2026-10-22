export const ANALYSIS_INTERVAL_MS = 1000 / 60;
export const AUDIO_SAMPLE_RATE = 48000;
export const ANALYSIS_BUFFER_SIZE = 4096;

// Preserve the 60 Hz phase despite frame jitter; never run a burst after a slow frame.
export function nextAnalysisTime(previous, timestamp) {
  if (!Number.isFinite(previous)) return timestamp;
  const elapsed = timestamp - previous;
  const frameTolerance = 0.5;
  if (elapsed + frameTolerance < ANALYSIS_INTERVAL_MS) return null;
  return (
    previous +
    Math.max(1, Math.floor((elapsed + frameTolerance) / ANALYSIS_INTERVAL_MS)) *
      ANALYSIS_INTERVAL_MS
  );
}

export function createAudioContext(AudioContextClass) {
  try {
    return new AudioContextClass({ sampleRate: AUDIO_SAMPLE_RATE });
  } catch (error) {
    if (error.name !== 'NotSupportedError') throw error;
    return new AudioContextClass();
  }
}
