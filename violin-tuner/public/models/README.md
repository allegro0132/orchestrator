# ARCO Music Transformer v1

Experimental small-corpus monophonic continuation model, trained for this application. This is an independently trained compact relative-attention decoder, not Google's pretrained Music Transformer checkpoint. It predicts a musical continuation, not the player's intended next note.

## Architecture and runtime

- 98,613 learned parameters; 394,452 bytes of little-endian float32 weights.
- Two pre-norm causal decoder blocks, width 64, four attention heads, feed-forward width 128, GELU, layer normalization epsilon 1e-5.
- Learned relative **key** vectors per head and distance 0–63; scores are `(Q K^T + Q R^T) / sqrt(16)`. The bounded context uses direct attention, rather than the paper's long-sequence skew optimization. No relative value vectors or absolute position embeddings.
- Vocabulary: BOS 0, then 30 pitches (MIDI 55–83 and rest) × six quarter-note durations (0.5, 1, 1.5, 2, 3, 4). Token = `1 + pitchIndex * 6 + durationIndex`.
- Pitch/rhythm compound events are a simplification of performance-event tokenization. Dynamics, polyphony, bowing and time signatures other than 4/4 are not modeled.
- Plain JavaScript float32 inference in a dedicated Web Worker, incremental KV caches, at most 64 cached events per layer. No ML runtime download, remote inference service, API key or audio upload.
- Runtime checks the weights' SHA-256 from the manifest. Both files are served with the application under its Pages base path. The browser may use its normal HTTP cache.
- Sampling: temperature 0.85, top 8, seeded RNG. Masks enforce the chosen diatonic key, violin range and remaining bar duration; they do not supply the predicted melody. High captured notes are octave-folded only for prediction context; original captured pitches are retained.

The implementation follows the relative-attention principle described in [Music Transformer (Huang et al., 2018)](https://arxiv.org/abs/1809.04281). It does not reproduce that paper's training scale, performance encoding or quality results.

## Training, sources and limitations

Training uses five existing **public-domain practice editions**: Old 100th, Ode to Joy, Brahms' Lullaby, Minuet in G (first section), and Red Apple Rag (opening). Credits, original editions and arrangement details remain in [score sources](../scores/SOURCES.md). Transpositions within G3–B5 produce 66 training sequences, not 66 independent compositions. No CC BY or CC BY-SA editions are included.

Greensleeves is held out as an entire composition, including all its transpositions. Windows from it never enter training. Validation is used for checkpoint selection and is therefore **not an independent test set**. This tiny corpus cannot establish broad musical quality; repetition, awkward phrases and training-melody similarities are expected. This is a working experimental baseline, not a broadly pretrained model.

Seed 1729, CPU PyTorch 2.9.0, AdamW (learning rate 0.0015, weight decay 0.01), batch 16, context 64, gradient norm limit 1, label smoothing 0.05, 400 optimizer steps. Checkpoints are evaluated every 20 steps. Selected checkpoint: step 100. Validation next-event cross entropy: 4.6609 nats, versus 5.3877 at random initialization and 5.0499 for a training-frequency unigram baseline (add-one smoothing). These metrics describe this one small held-out composition only; quality should be assessed through actual playing.

Weights and accompanying metadata are dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Training input editions retain the provenance linked above. The application inference and training implementation are supplied as repository source.

## Reproduction

From the repository root:

```sh
node violin-tuner/scripts/music-transformer/corpus.mjs
python3 -m venv /tmp/arco-mt
/tmp/arco-mt/bin/pip install -r violin-tuner/scripts/music-transformer/requirements.txt
/tmp/arco-mt/bin/python violin-tuner/scripts/music-transformer/train.py
npm --prefix violin-tuner test
```

The exporter writes the float32 weights, tensor manifest, training metrics and step-by-step reference logits. JavaScript tests compare cached inference against PyTorch logits within 2e-5. Dependency versions and CPU seed are pinned; floating-point results may differ across platforms. Changing tokenization, architecture or weights requires a new model ID and updated fixtures.
