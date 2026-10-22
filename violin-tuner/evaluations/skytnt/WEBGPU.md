# W4A16 + WebGPU priority path

The preferred browser deployment candidate is now **INT4 linear weights + FP16 activations/KV cache + WebGPU**, with explicit FP32 stability islands for RMSNorm, rotary-position calculations and softmax. The conversion and actual desktop-browser inference paths have been implemented and tested. Production Vibe still uses the compact model; these large converted weights have not been added to the public app or downloaded automatically.

## What was verified

The pinned SkyTNT checkpoint and tokenizer remain those documented in the [native evaluation](README.md). `convert_w4a16.py` checks the original weight hashes, converts the floating graph, packs constant MatMul weights into symmetric four-bit blocks of 32, runs full ONNX type/shape validation, and writes a manifest with output hashes and precision metadata. The base and parameter models contain 84 and 22 `MatMulNBits` nodes respectively. Dynamic attention MatMuls are not weight-quantized. Embeddings retain FP16 weights; normalization weights retain FP32 in the stable recipe.

| Representation                         | Combined ONNX bytes | Relative to original |
| -------------------------------------- | ------------------: | -------------------: |
| Official FP32                          |         938,375,268 |                 100% |
| FP16 control, with stability islands   |         470,825,570 |                50.2% |
| Selected W4A16, with stability islands |     **144,494,146** |            **15.4%** |

W4A16 reduces the downloaded model size by approximately **84.6% / 6.49×**. This is a file-size result, not a measurement of peak browser RAM or VRAM. Four-bit weights require scales and some weights remain floating point, so the complete models do not achieve an eightfold reduction.

[ONNX Runtime's weight-only quantization documentation](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html#quantize-to-int4uint4) describes the `MatMulNBits` representation. The converter uses RTN and `accuracy_level=0`, not activation INT8 quantization. [WebGPU IO binding](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html#keep-tensor-data-on-gpu-io-binding) is used for the cross-model bridge and both KV caches.

`SkyDecoder` batches deterministic event/track/channel/velocity fields into the next uncertain-token inference call. The converted graphs return only the final hidden/logit row. Base hidden states feed the parameter model as GPU buffers, and KV caches stay on the GPU; only logits needed for masked sampling return to the CPU. Runtime tensor evidence confirms `float16` and `gpu-buffer` for both hidden states and cache outputs. Shape/control operations may still run on the CPU; this does not claim that every graph node is GPU-only or that GPU accumulation is necessarily FP16.

## Precision: why the FP32 islands matter

The comparison teacher-forces **identical contexts and event prefixes** from six earlier continuations. It records logits only where the legal mask has more than one candidate: 379 decisions, including 103 pitch and 97 duration decisions. KL is computed over the entire legal distribution at temperature one, independently of the generation sampler's temperature/top-k. Thus different randomly generated melodies cannot make the precision comparison misleading.

| Graph                               | All top-1 agreement | Pitch top-1 agreement | Duration top-1 agreement | Mean legal-distribution KL |
| ----------------------------------- | ------------------: | --------------------: | -----------------------: | -------------------------: |
| Pure-half W4 initial experiment     |               60.9% |             **16.5%** |                    36.1% |                     0.6958 |
| W4A16 with FP32 islands             |           **96.8%** |             **91.3%** |                **96.9%** |                **0.00377** |
| FP16 with the same islands, no INT4 |               99.7% |                 99.0% |                     100% |                   0.000476 |

The pure-half result is rejected. Keeping sensitive calculations in FP32 largely removes its numerical degradation. The three islands were changed together; this experiment does not separately attribute the improvement to each individual operator group. The remaining W4-versus-FP32 difference includes real weight-quantization error. This small probe is not a guarantee of equal musical quality, and near-tied top choices can change even with a small KL divergence.

Two conversion issues are handled explicitly: the converter's retained rotary `Cast(to=FLOAT)` must agree with the graph's declared types, and newly inserted FP32 island Casts must remain FP32. `onnx.checker.check_model(..., full_check=True)` catches inconsistent types. The complete output is therefore a standard mixed-precision W4A16 recipe, **not a claim that every operation in the model uses FP16**.

## Actual browser measurements

Tested on the same Apple M3 Max host, in Chromium 155 with `shader-f16`, ONNX Runtime Web **1.30.0**, WebGPU EP, one WASM control thread, and a dedicated Worker. Both models run locally; no microphone, external inference API or audio upload is used by the harness. Native CPU measurements in the earlier report must not be confused with these GPU measurements.

In the recorded stable W4A16 run, session creation took **611 ms** after a **196 ms loopback file fetch/checksum**. Four-bar continuations took **678–1,124 ms**, with first-event times of **42–106 ms**. These are measurements from this one run, including first-trial setup effects; they are not a cold internet-download result. The native CPU remains faster on this host for these short prompts; WebGPU is prioritized here for browser execution and the much smaller model representation.

Six four-bar free continuations and six teacher-forced comparisons complete successfully. The same single-line, G3–B5, bounded-gap and exact-four-bar masks remain active. Model setup and first-use shader/pipeline work are separate from warmed generation. Browser/driver caches and prior runs can affect these numbers; the local file fetch is not an internet-download benchmark. Raw per-trial timings, GPU tensor evidence, sampled rows and comparison logits are in [the W4A16 report](results/webgpu-w4a16.json). The [FP16 control](results/webgpu-fp16.json) and [rejected pure-half experiment](results/webgpu-pure-half-rejected.json) are retained for comparison.

Example [MIDI](results/w4a16-detected-d-melody.mid) and [MusicXML](results/w4a16-detected-d-melody.musicxml) include the performed primer followed by the W4A16 continuation. Ode and Minuet seed-17 examples are included too.

No iPhone/Android/Safari inference or peak browser-memory measurement has been performed. The result supports prioritizing W4A16 + WebGPU as a browser candidate, rather than assuming that smaller weight files alone prove mobile viability. Musical quality still requires listening and longer-context evaluation; the reference phrases are familiar examples and not a held-out music-quality benchmark.

## Reproduce

The original models must already be downloaded and hash-verified as described in the native report. Install dependencies separately from the shipped app:

```sh
npm ci --prefix violin-tuner
npm ci --prefix violin-tuner/evaluations/skytnt
python3 -m venv /tmp/arco-w4a16-tools
/tmp/arco-w4a16-tools/bin/pip install -r violin-tuner/evaluations/skytnt/requirements-w4a16.txt
/tmp/arco-w4a16-tools/bin/python violin-tuner/evaluations/skytnt/convert_w4a16.py /tmp/arco-skytnt-eval /tmp/arco-skytnt-w4a16
```

Regenerate the teacher-forced FP32 reference only when deliberately updating the benchmark fixture:

```sh
node violin-tuner/evaluations/skytnt/reference_w4a16.mjs /tmp/arco-skytnt-eval /tmp/fp32-choices.json
```

The browser uses the checked-in `results/fp32-choices.json`. If evaluating a new source revision, update the tokenizer/manifest, benchmark prompts and reference together. A different checkpoint must never be compared against stale reference logits.

Start the isolated browser harness:

```sh
SKY_W4A16_DIR=/tmp/arco-skytnt-w4a16 npm run webgpu --prefix violin-tuner/evaluations/skytnt
```

Open `http://127.0.0.1:5181/evaluations/skytnt/webgpu.html`. It checks `shader-f16` before enabling **Run WebGPU evaluation**, fetches weights only when clicked, validates hashes, and supports cancellation/restart and a three-minute watchdog. Successful reports save only into the configured temporary model directory. Model routes are restricted to named model files and the report route accepts only same-origin JSON with bounded size and a restricted report identifier. Stop this development server when testing is finished.

For an unquantized FP16 control, convert with `--bits 16` into a separate directory and set `SKY_W4A16_DIR` to it. `--pure-half` reproduces the rejected absence of stability islands; it is an ablation option, not the deployment recommendation. Source and converted model binaries are intentionally outside Git.

ONNX Runtime Web 1.30.0's `webgpu` entry uses the matching **Asyncify** WASM pair; overriding it with the JSEP pair causes a backend initialization error. Package/runtime assets must stay pinned together. The native reference uses ONNX Runtime Node 1.30.0; conversion uses the separately pinned Python tools.

## Product adoption policy

1. Prioritize the stable W4A16/WebGPU provider on compatible devices, behind an explicit model-download/enable action.
2. Require WebGPU and `shader-f16`; keep the compact local engine available for unsupported devices or declined/failed downloads. Do not silently substitute a large FP32/WASM download.
3. Before making this the mobile default, measure real iOS/Android latency, memory, model-cache quotas, device loss and long sessions, and perform a listening comparison. Persist the exact model/recipe ID with each accepted revision.
4. Publish converted weights with the source license/attribution, original and converted hashes, and conversion recipe using suitable model hosting or shards. They are not published by this evaluation change.

The proposed priority route is implemented and desktop-verified. App UI/provider selection, distributed weight hosting/cache and mobile-device qualification remain separate deployment work.
