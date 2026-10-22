"""Prepare compact CC0 VSCO multisamples. Requires NumPy and original WAVs."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import wave
import numpy as np

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
output = root / 'public/audio/violin'
output.mkdir(parents=True, exist_ok=True)
metadata = []
for name, midi in [('G3',55),('C4',60),('E4',64),('G4',67),('C5',72),('E5',76),('G5',79),('C6',84),('E6',88),('C7',96)]:
    path = source / f'{name}.wav'
    with wave.open(str(path)) as wav:
        rate = wav.getframerate()
        x = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').reshape(-1,wav.getnchannels()).mean(axis=1) / 32768
    # Remove leading silence while retaining the recorded bow attack.
    active = np.flatnonzero(np.abs(x) > np.max(np.abs(x)) * .025)
    x = x[max(0,int(active[0])-int(rate*.008)):]
    expected = 440 * 2 ** ((midi-69)/12)
    estimates = []
    for begin in np.arange(.6,2.5,.06):
        frame = x[int(begin*rate):int((begin+.09)*rate)].copy()
        frame -= frame.mean()
        n = 2 ** int(np.ceil(np.log2(len(frame)*2)))
        corr = np.fft.irfft(abs(np.fft.rfft(frame,n))**2,n)[:len(frame)]
        lag = max(range(int(rate/expected/1.07),int(rate/expected/.93)),key=lambda i:corr[i])
        delta = .5*(corr[lag-1]-corr[lag+1])/(corr[lag-1]-2*corr[lag]+corr[lag+1])
        estimates.append(rate/(lag+delta))
    measured = float(np.median(estimates))
    # Low-pass before downsampling. Keep a short attack and a crossfaded sustain loop.
    spectrum = np.fft.rfft(x)
    frequencies = np.fft.rfftfreq(len(x),1/rate)
    spectrum *= np.clip((11000-frequencies)/1000,0,1)
    x = np.fft.irfft(spectrum,len(x))
    target_rate = 24000
    x = np.interp(np.arange(int(2.6*target_rate))/target_rate, np.arange(len(x))/rate, x)
    start, end, cross = int(.6*target_rate),len(x),int(.08*target_rate)
    blend = np.linspace(0,1,cross)
    x[-cross:] = x[-cross:]*(1-blend)+x[start-cross:start]*blend
    x[:int(.008*target_rate)] *= np.linspace(0,1,int(.008*target_rate))
    x *= .75 / max(.01,np.max(np.abs(x)))
    target = output / f'{midi}.wav'
    with wave.open(str(target),'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(target_rate)
        wav.writeframes((np.clip(x,-1,1)*32767).astype('<i2').tobytes())
    metadata.append(dict(midi=midi,hz=round(measured,6),loopStart=.6,loopEnd=2.6,source=path.name,sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
(root/'src/violinSamples.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps([{k:s[k] for k in ['midi','hz']} for s in metadata]))
