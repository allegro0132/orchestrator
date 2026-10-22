"""Train the experimental small relative-attention melody decoder on local PD editions.
Run corpus.mjs first. CPU only; never used by the production app or CI.
"""
import argparse
import copy
import hashlib
import json
import math
import pathlib
import random
import time

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = pathlib.Path(__file__).resolve().parents[2]
DURATIONS = [0.5, 1, 1.5, 2, 3, 4]
CONFIG = dict(width=64, heads=4, layers=2, ff=128, context=64, vocab=181)


def token(midi, duration):
    pitch = 29 if midi is None else midi - 55
    rhythm = min(range(6), key=lambda i: abs(DURATIONS[i] - duration))
    return 1 + pitch * 6 + rhythm


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.norm1 = nn.LayerNorm(64)
        self.qkv = nn.Linear(64, 192)
        self.relative = nn.Parameter(torch.randn(4, 64, 16) * 0.02)
        self.proj = nn.Linear(64, 64)
        self.norm2 = nn.LayerNorm(64)
        self.fc1 = nn.Linear(64, 128)
        self.fc2 = nn.Linear(128, 64)

    def forward(self, x):
        b, n, _ = x.shape
        q, k, v = self.qkv(self.norm1(x)).view(b, n, 3, 4, 16).permute(2, 0, 3, 1, 4)
        positions = torch.arange(n)
        distance = (positions[:, None] - positions[None, :]).clamp(0, 63)
        # Direct relative-key attention; the short context does not need skew optimization.
        relative = torch.einsum('bhid,hijd->bhij', q, self.relative[:, distance, :])
        scores = (q @ k.transpose(-2, -1) + relative) / 4
        scores = scores.masked_fill(positions[None, :] > positions[:, None], -float('inf'))
        y = (scores.softmax(-1) @ v).transpose(1, 2).reshape(b, n, 64)
        x = x + self.proj(y)
        return x + self.fc2(F.gelu(self.fc1(self.norm2(x)), approximate='tanh'))


class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Embedding(181, 64)
        self.blocks = nn.ModuleList([Block() for _ in range(2)])
        self.norm = nn.LayerNorm(64)
        self.head = nn.Linear(64, 181)

    def forward(self, x):
        x = self.embed(x)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=400)
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(1729)
    random.seed(1729)
    pieces = json.loads((ROOT / 'scripts/music-transformer/corpus.json').read_text())
    training, validation = [], []
    for piece in pieces:
        # Hold out a whole composition, including all transpositions, to avoid window leakage.
        target = validation if piece['id'] == 'greensleeves' else training
        pitched = [e['midi'] for e in piece['events'] if e['midi'] is not None]
        for shift in range(-12, 13):
            if min(pitched) + shift < 55 or max(pitched) + shift > 83:
                continue
            target.append([0] + [token(None if e['midi'] is None else e['midi'] + shift, e['duration']) for e in piece['events']])

    def batch(sequences, batch_size=16):
        xs, ys = [], []
        for _ in range(batch_size):
            sequence = random.choice(sequences)
            start = random.randrange(max(1, len(sequence) - 8))
            segment = sequence[start:start + 65]
            x, y = segment[:-1], segment[1:]
            xs.append(x + [0] * (64 - len(x)))
            ys.append(y + [-100] * (64 - len(y)))
        return torch.tensor(xs), torch.tensor(ys)

    model = Model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.0015, weight_decay=0.01)
    # Fix validation batches, ensuring checkpoints are compared against identical targets.
    validation_batches = [batch(validation) for _ in range(8)]

    def evaluate():
        model.eval()
        with torch.no_grad():
            loss = sum(F.cross_entropy(model(x).reshape(-1, 181), y.reshape(-1)).item() for x, y in validation_batches) / len(validation_batches)
        model.train()
        return loss

    counts = torch.ones(181)
    for sequence in training:
        for event in sequence[1:]:
            counts[event] += 1
    unigram = -(counts / counts.sum()).log()
    baseline = sum(unigram[y[y != -100]].mean().item() for _, y in validation_batches) / len(validation_batches)
    initial = evaluate()
    best, best_state, best_step, selected_train_loss = initial, copy.deepcopy(model.state_dict()), 0, initial
    began = time.time()
    train_loss = initial
    for step in range(1, args.steps + 1):
        x, y = batch(training)
        optimizer.zero_grad(set_to_none=True)
        loss = F.cross_entropy(model(x).reshape(-1, 181), y.reshape(-1), label_smoothing=0.05)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1)
        optimizer.step()
        train_loss = loss.item()
        if step % 20 == 0:
            val = evaluate()
            if val < best:
                best, best_state, best_step, selected_train_loss = val, copy.deepcopy(model.state_dict()), step, train_loss
            print(f'{step}: train={train_loss:.4f} heldout={val:.4f} elapsed={time.time()-began:.1f}s', flush=True)
    model.load_state_dict(best_state)
    model.eval()
    out = ROOT / 'public/models'
    tensors, chunks, offset = {}, [], 0
    for name, tensor in model.state_dict().items():
        array = tensor.detach().cpu().numpy().astype('<f4')
        tensors[name] = dict(shape=list(array.shape), offset=offset, length=array.size)
        chunks.append(array.tobytes())
        offset += array.size
    weights = b''.join(chunks)
    (out / 'arco-mt-v1.bin').write_bytes(weights)
    metadata = dict(id='arco-mt-v1', architecture='causal-relative-key-attention', config=CONFIG,
                    durations=DURATIONS, minMidi=55, maxMidi=83, tensors=tensors,
                    sha256=hashlib.sha256(weights).hexdigest(), bytes=len(weights),
                    training=dict(seed=1729, steps=args.steps, selectedStep=best_step,
                                  initialValidationLoss=initial, validationLoss=best, unigramValidationLoss=baseline,
                                  selectedTrainingLoss=selected_train_loss, finalTrainingLoss=train_loss, holdout='greensleeves',
                                  trainPieces=[p['id'] for p in pieces if p['id'] != 'greensleeves'],
                                  augmentedTrainSequences=len(training),
                                  limitations='Experimental small-corpus model. Transpositions are augmentation, not independent compositions. No broad musical-quality benchmark.'))
    (out / 'arco-mt-v1.json').write_text(json.dumps(metadata, indent=2) + '\n')
    cases = []
    for sequence in [[0, token(62, 1), token(64, 1), token(66, 1)], [0, token(69, 2), token(67, .5), token(None, .5), token(64, 1)]]:
        with torch.no_grad():
            logits = model(torch.tensor([sequence]))[0].tolist()
        cases.append(dict(tokens=sequence, logits=logits))
    (ROOT / 'scripts/music-transformer/reference.json').write_text(json.dumps(cases) + '\n')
    print(json.dumps(metadata['training'], indent=2))


if __name__ == '__main__':
    main()
