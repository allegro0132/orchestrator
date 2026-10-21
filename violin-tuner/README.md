# ARCO Violin Tuning Studio

A responsive violin tuner built with React and Vite for desktop and mobile browsers.

## Development

```sh
npm ci
npm run dev
```

From this directory, run the following checks before pushing:

```sh
npm run format
npm run format:check
npm test
npm run build
```

See the [repository README](../README.md) for GitHub Pages deployment instructions.

## Tuning features

- Local microphone pitch detection, automatic open-string recognition, a cents meter, and reference tones.
- All four violin strings, first through fifth positions, four common finger patterns, and targets for fingers 1–4.
- An A4 reference from 430 to 450 Hz, saved on the device.
- Equal temperament. Positions 2–5 shift the first-position pattern up by 2, 4, 5, and 7 semitones, respectively. The fingerboard labels show intervals relative to the selected position.

Microphone input requires HTTPS or localhost. Bow a single note in a quiet environment, and keep the browser in the foreground on mobile. Synthetic pitch tests do not guarantee performance with every real violin, microphone, or room.

## Audio sampling and update rate

The tuner requests a 48 kHz AudioContext and an ideal 48 kHz microphone input. Unsupported AudioContext sample rates fall back to the browser default; pitch detection always uses the actual AudioContext rate. Hardware input rates remain subject to browser and device support.

Pitch analysis targets 30 readings per second, up from roughly 10, while retaining the 4,096-sample analysis window. Automatic target changes require at least 180 ms of consistent readings so faster updates do not make target selection unstable.

## Metronome practice mode

The metronome is a separate practice mode alongside Open strings and Finger practice. It supports 40–240 BPM, 1/4, 2/4, 3/4, 4/4, and 6/8 meters, an optional first-beat accent, volume control, and beat indicators. BPM counts each click, so 6/8 plays six clicks per bar.

Clicks are scheduled against the Web Audio clock with a 100 ms lookahead and a 25 ms scheduler interval. Missed beats after a delayed timer are skipped rather than played in a burst. Tempo and meter changes cancel pending clicks before restarting the bar. Settings are saved locally under `arco-metronome`.

Entering the metronome stops microphone tuning. Leaving the mode, hiding the page, or navigating away stops its scheduled audio and visual callbacks. This keeps metronome clicks out of microphone analysis.

## Pitch history and success detection

The app keeps six seconds of raw pitch measurements in memory and displays a pitch trace, a recent average cents deviation, and its standard deviation. The main needle uses a three-frame median filter; success detection uses raw measurements so smoothing cannot hide pitch variation.

Success requires readings spanning at least 0.5 seconds within a rolling 0.7-second window, with:

- At least five valid readings and 85% valid sample coverage.
- An average deviation within ±20 cents.
- At least 80% of readings within ±20 cents.
- A standard deviation no greater than 20 cents.

A gap greater than 300 ms between valid readings restarts accumulation, so silence or background pauses cannot count toward a sustained note.

Success remains visible after releasing a note. After 0.3 seconds of silence or off-target pitch, the next note starts a new check. Restarting the microphone, changing the target, or choosing **Try again** also clears the result. History stays in the current page's memory; the app does not record audio or combine measurements from different targets.

Quiet-sound detection uses an RMS threshold of 0.002. Measurements must also pass a periodic-correlation check to reduce false detections from random background noise.

## Success sound

Each new successful hold plays a gentle rising chime lasting about 0.42 seconds. Holding the same accurate note does not repeatedly play the chime. After release or an off-target note lasting 0.3 seconds, another stable 0.5-second hold can trigger a new chime without a manual reset.

Microphone analysis, the needle, and the pitch trace keep updating during the chime. Automatic target switching and success re-arming are temporarily suppressed to prevent speaker feedback from causing unwanted switches or repeated cues. Visual feedback remains available when audio output is unavailable.

## Fixed chart range and automatic finger detection

The pitch chart stays at ±50 cents. Out-of-range readings appear in brown at the edges; their original values are still used for statistics.

Finger practice matches open strings and fingers 1–4 across all four strings within the selected position and pattern. At least three consecutive matching readings spanning 180 ms are required before switching targets. When different strings can produce the same pitch, the current string takes priority.

Manually selecting a string or finger locks the target. The switch below the tuner restores automatic detection. Selecting a position or pattern also re-enables automatic detection.

## Languages

The interface supports English and Chinese, with English as the default. The header language menu switches immediately and saves the preference under `arco-language`. Switching languages preserves the selected string, finger, and pitch history.

The page title, HTML language attribute, practice guide, error messages, and tuning feedback switch together. Chinese translation strings are intentionally retained in the source to support the Chinese interface.
