# SkyTNT pretrained-model evaluation

**Verdict:** the pinned `tv2o-medium` checkpoint can continue recognized violin-note context with enforceable single-voice, pitch-range and exact-horizon constraints. Native desktop CPU latency passed this small feasibility test. The official FP32 download and memory footprint are too large to make it the default mobile-web model without further optimization and device testing. This directory is an offline evaluation harness and reusable adapter; production Vibe still uses `arco-mt-v1`.

**Browser update:** [W4A16 + WebGPU](WEBGPU.md) is now the preferred browser candidate, with real desktop inference and precision comparisons.

## Checkpoint and sources

- [Official model card](https://huggingface.co/skytnt/midi-model-tv2o-medium): model license Apache-2.0; training sources listed by the author include Los Angeles MIDI, Monster MIDI and SymphonyNet. Model licensing is not a statement that every training composition is public domain.
- Model revision: `0f8f265d4330f4e46527ac2313200254c5757f5f`.
- [Official tokenizer and inference source](https://github.com/SkyTNT/midi-model/tree/f504d5cb58f769ab0f2909c679238f6621034573): source revision `f504d5cb58f769ab0f2909c679238f6621034573`, Apache-2.0.
- Base ONNX: 821,713,887 bytes; token ONNX: 116,661,381 bytes. **938,375,268 bytes total (938 MB / 895 MiB)**, verified against the official LFS SHA-256 values. Weights remain outside the repository and Pages assets.
- Config: event-level decoder with 12 layers, width 1024 and 16 heads; event-parameter decoder with three layers, width 1024 and four heads. These are autoregressive Llama-style decoders, not the original Magenta relative-attention architecture. The official model card reports approximately 0.2B parameters.

No remote custom model code is required by the harness. It runs the two ONNX graphs with the official `onnxruntime-node` package, version 1.30.0. The tokenizer adapter independently implements the pinned V2 contract, with golden rows checked against the original constructor and conversion methods.

## Context and generation constraints

`skyPrompt(notes, options)` accepts the existing Vibe captured-note shape `{ midi, start, duration }`, where time values are seconds. It takes the last 32 beats / at most 64 notes, quantizes to the application's eighth-note grid, preserves rests through onset differences, and adds BOS, 4/4, tempo, optional key signature, and General MIDI violin program 40. Input pitches are preserved, including high notes; context is not restricted to the smaller output practice range. The input array is not modified.

Important tokenizer details:

- V2 uses 16 ticks **per quarter-note beat**, not per bar. `time1` is a delta in whole quarter notes relative to the previous event's coarse onset; `time2` is the current offset 0–15 within a quarter note.
- Token IDs follow the original constructor allocation order. The serialized config sorts object keys, so allocating IDs in config key order produces incorrect tokens.
- Each event is an eight-token row. Event-level and parameter-level KV caches have different head shapes and are maintained separately.

`skyAllowed()` applies masks **before sampling** at every parameter. Generation is forced to note events, one track and one non-percussion channel, while preserving model probabilities within the allowed set. A single MIDI channel alone does not guarantee monophony: the next onset must also be at or after the previous note's end.

- Output pitch range defaults to **G3–B5, MIDI 55–83**, matching the app's comfortable practice range. It is configurable; MIDI 55–98 was also exercised through the CLI. This default is narrower than the violin's full playable range.
- Durations are chosen from 0.5, 1, 1.5, 2, 3 and 4 beats, bounded by the remaining bar and requested horizon.
- The number of bars is configurable from one to four, in 4/4. The horizon starts at the next 4/4 bar boundary after the primer; any partial-bar padding before it is separate from the within-horizon gap limit. Events do not cross the horizon; gaps become explicit rests. Each output bar totals exactly four beats.
- EOS, extra instruments, controllers, tempo changes and new tracks are excluded inside the horizon.
- A gap is limited to one beat by default (`maxGapBeats` is configurable). An initial experiment without this limit produced a formally legal but undesirable 12-beat silence before a Minuet continuation. Bounded onset gaps removed that case.
- Key signatures condition the model; chromatic notes remain possible. This evaluation does not apply a diatonic pitch mask or claim perfect tonal correctness.

`skyAccept()` independently validates the sampled row and advances state. `skyBars()` validates the timeline again, fills rests, and maps to the app's `{ bar, events: [{ midi, beat, duration }] }` structure. `fromBar` supports an absolute application-bar offset. The current and next bar can therefore remain protected when integrating this provider with Vibe's asynchronous commit flow. Production integration must also store the SkyTNT checkpoint ID rather than the compact model's hardcoded predictor ID.

## Measured results

Tested locally on Apple M3 Max, macOS arm64, Node 26.8.1, ONNX Runtime Node 1.30.0, CPU provider, **two intra-op threads / one inter-op thread**, batch one. Both official FP32 models were loaded in one process. Session creation took approximately **513 ms** from already downloaded, OS-cached files; peak process RSS was **1.14 GiB**. This excludes network download time and is not a cold browser-load measurement.

Three primers × two seeds (17, 29), each continuing for four 4/4 bars at 60 BPM. Primers: the first twelve notes of the bundled Ode and Minuet editions, plus eight D-major notes passed through the actual pitch detector/transcriber with synthetic vibrato. Minuet's melody is deliberately re-barred into the current Vibe 4/4 format. These familiar pieces are not an unseen quality-test set.

| Primer            | Seed | Four-bar generation | First generated event | Notes | Rest beats |
| ----------------- | ---: | ------------------: | --------------------: | ----: | ---------: |
| Ode               |   17 |              293 ms |                 50 ms |    13 |          1 |
| Ode               |   29 |              351 ms |                 50 ms |    16 |          0 |
| Minuet            |   17 |              448 ms |                 50 ms |    20 |          0 |
| Minuet            |   29 |              456 ms |                 51 ms |    21 |          0 |
| Detected D melody |   17 |              398 ms |                 43 ms |    19 |          0 |
| Detected D melody |   29 |              300 ms |                 42 ms |    14 |          0 |

All six constrained runs reached the full horizon, with **zero pitch-range violations, overlapping notes, or events outside the horizon**. Auditing confirms four complete bars in every run. The adapter tests additionally cover one, two and four bars, global bar offsets, long held inputs, silence and rejection of invalid output.

The comparison mode also forces note events, violin track/channel and fixed velocity, but leaves pitch, timing and duration unconstrained. Across six comparison runs it produced **167 notes, 10 outside the practice range, 76 onset overlaps and 12 events outside the requested interval**. Two Minuet runs exhausted the 32-note budget before reaching the horizon. Counts overlap and do not represent independent error rates. This demonstrates why post-filtering by instrument/channel is insufficient; it is not a benchmark against every decoding strategy.

Latency includes context prefill, parameter sampling and KV-cache updates, but excludes model loading, score engraving and microphone capture. Sampling uses temperature 0.85 and top-k 20. This is a feasibility probe on one powerful desktop, not a statistically representative latency or musical-quality benchmark. The same seed diverges between masks because distributions and event counts differ.

The continuations reuse recognizable motion from the primers, but some repeat notes or alternating patterns. Structural constraints guarantee playable notation, **not musical quality or the player's intended next note**. No blind listening evaluation or direct quality comparison against `arco-mt-v1` was performed. Inspect the exported examples before deciding on musical quality.

## Browser and product decision

The working native path is a reasonable candidate for a desktop optional engine or a separately configured local inference service. At 60 BPM, the current two-bar protected lookahead gives eight seconds; the measured native four-bar generation fits comfortably inside that budget. This observation does not establish equivalent speed on other hardware.

For a browser implementation, use an off-main-thread provider, explicit model download/cache controls, progress, cancellation, timeout and stale-session rejection. Preserve performed notes and every accepted generated revision. Native inference latency must **not** be presented as WASM/WebGPU latency. This section reports native FP32 results. Actual desktop W4A16/WebGPU results are now available in the [browser report](WEBGPU.md); iPhone and Android inference remain untested. [ONNX Runtime's large-model guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html) explains browser buffer and WASM memory limits; being below a file-size limit alone does not prove mobile feasibility.

The W4A16 conversion and desktop WebGPU gate have now been exercised. Next measure peak browser memory and latency on actual iOS/Android devices, then conduct a listening comparison. Verify supported operators and weight licensing/attribution for the exact chosen distribution. Do not silently download the official 938 MB model when a mobile user opens Vibe. No API endpoint or remote note upload has been introduced here.

## Reproduce

Install the evaluation dependencies independently of the app:

```sh
npm ci --prefix violin-tuner/evaluations/skytnt
mkdir -p /tmp/arco-skytnt-eval
curl -fL 'https://huggingface.co/skytnt/midi-model-tv2o-medium/resolve/0f8f265d4330f4e46527ac2313200254c5757f5f/onnx/model_base.onnx' -o /tmp/arco-skytnt-eval/model_base.onnx
curl -fL 'https://huggingface.co/skytnt/midi-model-tv2o-medium/resolve/0f8f265d4330f4e46527ac2313200254c5757f5f/onnx/model_token.onnx' -o /tmp/arco-skytnt-eval/model_token.onnx
node violin-tuner/evaluations/skytnt/evaluate.mjs /tmp/arco-skytnt-eval /tmp/skytnt-results
```

The runner checks both hashes before loading and rejects mismatched weights. It does not download them automatically. ONNX native diagnostic files, if any, remain in the supplied temporary model directory. Ordinary app tests and CI neither install these evaluation dependencies nor download model weights.

Use an exported Vibe JSON take as real captured context, with two generated bars and a larger output register:

```sh
node violin-tuner/evaluations/skytnt/evaluate.mjs /tmp/arco-skytnt-eval /tmp/skytnt-my-take --take=/absolute/path/to/arco-vibe.json --bars=2 --min-midi=55 --max-midi=98 --constrained-only
```

Files stay local. A custom take is evaluated alongside the fixed fixtures; choose a temporary output directory rather than replacing checked-in reference results. Timing changes with hardware, caches and concurrent activity.

[Raw benchmark and token rows](results/benchmark.json) retain the pinned checkpoint, prompts, sampled rows, event timelines, audits and individual timings. Example [detected melody MIDI](results/detected-d-melody-17.mid) and [MusicXML](results/detected-d-melody-17.musicxml) include the eight-beat performed primer followed by the sixteen-beat generated continuation. The other examples include their twelve-note primers too. Import a sample into Score practice to inspect it and practice along; MIDI can also be auditioned in a MIDI player. The source editions retain the [existing score credits](../../public/scores/SOURCES.md); evaluation continuations are labeled model suggestions, not transcribed user performance.
