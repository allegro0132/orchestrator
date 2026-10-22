# SkyTNT W4A16 browser deployment

This directory hosts the exact stable-v2 artifacts evaluated in [the WebGPU report](../../../evaluations/skytnt/WEBGPU.md). Upstream: [SkyTNT midi-model-tv2o-medium](https://huggingface.co/skytnt/midi-model-tv2o-medium), Apache-2.0. See LICENSE and NOTICE. `manifest.json` records source revision, precision recipe, complete model hashes, and shard hashes.

Total weight payload: **144,494,146 bytes** (144.5 decimal MB). Files are split into 16 MiB shards to fit GitHub's per-file limits and support resumable Cache API downloads. These are ordinary static assets served by GitHub Pages, without Git LFS or an inference server. The app downloads and verifies each shard in a Web Worker, reconstructs and verifies each complete ONNX model, then creates WebGPU sessions. Cache failures permit memory-only loading with a visible notice. Browser storage eviction can remove cached shards. Cancellation terminates the worker, preserving completed cached shards. Retries explicitly initiated by the user reuse those shards.

Only the user-selected Transformer loads weights and ONNX Runtime 1.30.0. Rule-based mode is the default and requires neither. Runtime WASM/MJS add roughly 27 MB uncompressed assets; transfer compression depends on the host. GPU initialization also consumes memory beyond the weight payload. `shader-f16` is required. KV caches and the base-to-token hidden state stay on GPU; logits are read back. CPU FP16 inference is not a fallback. Tested on desktop Chromium; mobile hardware support and performance vary.

The pretrained model is general MIDI, not a violin-specific performance evaluator. Constrained decoding enforces monophony, G3–B5, 4/4 and requested bar lengths; it does not guarantee musical quality. Captured notes and the locked next bar form context. Audio stays on device. Revisions identify `skytnt-tv2o-medium-w4a16-stable-v2`; default rule revisions identify `arco-rules-v1`.

To reproduce packaging after running the conversion pipeline:

```sh
python3 scripts/package-sky-weights.py /path/to/converted-models
```

Keep model IDs immutable: a changed conversion must get a new ID, manifest and cache namespace. The unit suite reconstructs all hosted files and checks their SHA-256 against the tested artifacts.
