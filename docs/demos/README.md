# ARCO animated demos

These GIFs capture the application's actual `ScoreNotation`, streaming staff and `ScoreHUD` components in a local demo harness. Input notes are synthesized; no microphone recordings or personal performance data are included. Both GIFs loop, at 880 × 740 pixels. A shared palette and incremental frames reduce download size without adding runtime dependencies to the app.

- **pitch-combo.gif** — roughly eight seconds of pitch feedback, including Perfect/Good hits, one intentionally wrong note, a missed-note verdict and a rebuilt combo. It runs the same `analyseScore` and `practiceFeedback` logic as score/beginner practice.
- **vibe-skytnt.gif** — roughly ten seconds of actual on-device SkyTNT continuation, with captured-note and generated-bar counters, complete measures appended to the horizontal score, and upcoming-note cues. It uses synthetic monophonic D-major input at 120 BPM, and the production Web Worker, prompt constraints and streaming commit path. No rule-based generation is used.

The model is `skytnt-tv2o-medium-w4a16-stable-v2`: INT4 weights, FP16 computation and WebGPU. Loading used previously downloaded, checksum-verified cached weights and the production four-bar self-test. [vibe-skytnt-inference.json](vibe-skytnt-inference.json) records the model ID, synthetic input requests, actual streamed bar payloads and measured inference times from the capture. These timings describe this desktop capture, not a performance promise for other devices.

Frames were captured from the DOM in the browser and encoded locally with temporary html-to-image/gifenc tools, then palette-optimized with Pillow. The temporary harness and capture dependencies are excluded from the application and its deployment. GIF timing reflects capture intervals; animation may look less smooth than the live application.
