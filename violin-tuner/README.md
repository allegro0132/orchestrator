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

## Score practice and live analysis

Score practice is a separate mode. Import `.musicxml`, `.xml` (score-partwise MusicXML), compressed `.mxl`, or `.mid` / `.midi` files up to 10 MB. Scores and microphone samples are processed locally; no audio or score file is uploaded. A built-in melody lets you try the notation interface before selecting a file.

Select a part and voice, a starting measure, and either the score's tempo map or a fixed practice tempo. The notation always retains the complete score as one horizontal ribbon. An amber cursor and a row of upcoming notes show what to play next. Swipe or drag the notation to explore any measure. A four-quarter-beat visual count-in precedes practice; pause, resume, and restart are available. Microphone analysis stops on mode changes, hidden pages, and navigation.

Live analysis advances against the AudioContext clock at the selected tempo. It continues through mistakes rather than waiting for correct notes. Frequency detection targets 30 readings per second using the tuner's existing 48 kHz / 4,096-sample audio configuration and the saved A4 reference. It supports single-note violin input in the detector's approximate 170–2,400 Hz range.

The panel shows the expected frequency, measured frequency, cents deviation, and detected onset offset in milliseconds. Completed notes contribute to three separate metrics:

- **Pitch:** the proportion of voiced samples within ±20 cents of the written note. Silence is reported through coverage rather than included in this denominator.
- **Duration coverage:** voiced time divided by written note duration, including missed notes as zero coverage. Earlier measures are excluded when starting partway through a score.
- **Rhythm:** the proportion of detected onsets within ±150 ms of their written times, alongside the number of detected onsets. Missing attacks appear as **Not detected** in the note-by-note table and are not included in the rhythm percentage.

Onsets require a stable pitch change or a return after a gap. Repeated legato notes and bow changes cannot always be distinguished by a monophonic pitch detector. Browser input latency also affects timing; this feature provides practice feedback rather than a calibrated performance grade. Tests cover synthetic pitch, onset matching, silence, wrong notes, ties, tempo maps, part selection, and all supported import containers; they do not replace testing on real instruments and microphones.

MusicXML ties are merged for analysis, and score tempo changes are preserved. Playback follows written measure order without expanding repeats, endings, or navigation marks. Chords use the highest note of the selected voice. Grace notes are omitted from analysis. The notation still shows the source part; voice selection controls the analyzed line.

MIDI is converted to simplified notation, using one monophonic line per track. Simultaneous notes prefer the highest pitch; overlapping later notes are skipped. The first time signature determines bar grouping, and subsequent meter changes are not expanded. Prefer MusicXML when original notation, multiple voices, or complex rhythms matter. PDF/image recognition and adaptive following of rubato are not included.

The score UI and engraving library load on demand, keeping their download out of the initial tuner screen.

### Complete score and horizontal browsing

The complete selected part is engraved once as a single horizontal ribbon on a warm champagne background, with cocoa notation and an amber playhead. Every measure remains in the scrollable document; changing the current measure does not replace, crop, or re-engrave the score. Changing the viewport width preserves the same engraving and updates the follow position.

Phones support native horizontal swipes. Desktop users can drag with the primary mouse button, use horizontal trackpad scrolling or Shift + wheel, or use the left/right controls. The focused score region also supports Left/Right arrow keys and Home/End. The scrollbar remains available for direct navigation.

Manual pointer, wheel, or keyboard navigation suspends automatic following, so playback never pulls the viewport away from the user's browsing position. The playhead and analysis continue updating. **Follow note** returns to the current note and resumes following; starting or resuming playback also restores it. Selecting a starting bar while paused navigates to that bar.

The custom playhead uses compositor transforms with a tempo-aware easing duration. Cursor anchors are cached; ordinary forward playback advances the notation iterator rather than restarting it for every note. The system's reduced-motion preference disables cursor glides and smooth scrolling. Full-score engraving can take longer for large files, but it does not recur at bar boundaries.

## Beginner practice mode

Beginner practice is a fifth, independent mode with seven built-in exercises. It reuses the complete horizontal score, microphone analysis, tempo control, pause/resume, and starting-bar navigation from Score practice. No score import is needed. The selected exercise is saved locally under `arco-beginner-lesson`; imported scores in Score practice remain separate.

- **Slow long bows on D:** eight down/up pairs, four quarter-note beats per bow, starting at 40 BPM.
- **Four open strings:** D → A → G → E, four down/up pairs on each string, four beats per bow, with a four-beat placement rest before each new string.
- **Stop, place, play crossings:** D–A–D–A, A–E–A–E, then D–G–D–G, four rounds per pattern at 50 BPM. Every played note lasts one beat, followed by one stopped beat and one placement beat. The final placement becomes a finishing rest.
- **Left hand 1:** D–E–D–E–D.
- **Left hand 2:** D–E–F♯–E–D.
- **Left hand 3:** D–E–F♯–G–F♯–E–D.
- **Left hand 4:** D–E–F♯–G–A–G–F♯–E–D.

Left-hand exercises remain on the D string in first position, use fingers 0–4, and repeat each sequence four times with two beats per note at 50 BPM. The score includes bowing and fingering marks. Live action cards show down/up bow, the target string or finger, group/round number, beat indicators, and explicit stop/place instructions. Exercise selection is locked while starting or playing; pause before changing exercises. Beginner tempo options are 30–80 BPM.

Suggested right-hand practice blocks are four, four, and three minutes, including setup, mirror checks, and rest. These are practice-planning suggestions, not exact score durations. For example, the sixteen four-beat D bows take 96 seconds at 40 BPM; changing tempo changes the active score time while preserving the requested bow counts.

Instructions and manually checked checkpoints cover contact-point drift, bow straightness, even tone, smooth changes, arm level, thumb tension, neighboring strings, and a natural wrist. Audio feedback does not assess physical posture, contact point, or whether two strings were touched: those remain mirror/listening checks. Analysis remains monophonic and has the same onset-detection limits as Score practice. All exercise copy is available in English and Chinese, with English as the default interface language.
