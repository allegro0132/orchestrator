"""Publish verified converted ONNX models as immutable, Git-sized shards."""
import hashlib
import json
from pathlib import Path
import sys

source = Path(sys.argv[1])
manifest = json.loads((source / 'manifest.json').read_text())
target = Path(__file__).resolve().parents[1] / 'public/models' / manifest['id']
target.mkdir(parents=True, exist_ok=True)
for model in manifest['files'].values():
    data = (source / model['name']).read_bytes()
    assert len(data) == model['bytes']
    assert hashlib.sha256(data).hexdigest() == model['sha256']
    model['shards'] = []
    for i, offset in enumerate(range(0, len(data), 16 * 1024 * 1024)):
        chunk = data[offset:offset + 16 * 1024 * 1024]
        name = f"{model['name']}.{i:02d}.bin"
        (target / name).write_bytes(chunk)
        model['shards'].append(dict(name=name, bytes=len(chunk), sha256=hashlib.sha256(chunk).hexdigest()))
manifest['source'] = 'https://huggingface.co/skytnt/midi-model-tv2o-medium'
manifest['license'] = 'Apache-2.0'
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(target)
