export const ANALYSIS_INTERVAL_MS = 1000 / 30;
export const AUDIO_SAMPLE_RATE = 48000;
export const ANALYSIS_BUFFER_SIZE = 4096;

export function createAudioContext(AudioContextClass) {
  try {
    return new AudioContextClass({ sampleRate: AUDIO_SAMPLE_RATE });
  } catch (error) {
    if (error.name !== 'NotSupportedError') throw error;
    return new AudioContextClass();
  }
}
