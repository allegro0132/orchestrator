# Solo violin samples

Derived from **VSCO 2 Community Edition**, by Versilian Studios, under **CC0 1.0** (see LICENSE).

- Source: https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e/Strings/Solo%20Violin/Arco%20Vib
- Recorded by Sam Gossner and Simon Dalzell; sample cutting by Elan Hickler / Soundemote.
- Arco modifications: selected ten forte bowed solo-violin roots, removed leading silence, mixed to mono, low-pass filtered, resampled to 24 kHz / 16-bit PCM, normalized, and crossfaded a sustain loop. Recorded vibrato remains audible.
- `src/violinSamples.json` records source/output checksums, measured median fundamental frequency and loop bounds. Playback adjusts the sample rate to the selected A4 reference and requested note. This is a sampled violin guide, not a calibration oscillator.
- Reproduction: `python3 scripts/prepare-violin-samples.py /path/to/original-wavs` (NumPy required). Original filenames are recorded in the metadata.

Samples are hosted with the app and loaded only for notes being played. Decoded buffers are reused for the lifetime of the shared AudioContext. No third-party audio service is needed.
