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

Select a part and voice, a starting measure, and either the score's tempo map or a fixed practice tempo. Beginner practice appears before Score practice in the desktop and mobile mode lists. The notation always retains the complete score as one horizontal ribbon. An amber cursor and a floating performance overlay show the current note, measured pitch, onset timing and upcoming notes. Swipe or drag the notation to explore any measure. A four-quarter-beat visual count-in precedes practice; pause, resume, and restart are available. Microphone analysis stops on mode changes, hidden pages, and navigation.

Live analysis advances against the AudioContext clock at the selected tempo. It continues through mistakes rather than waiting for correct notes. Frequency detection targets 30 readings per second using the tuner's existing 48 kHz / 4,096-sample audio configuration and the saved A4 reference. It supports single-note violin input in the detector's approximate 170–2,400 Hz range.

The panel shows the expected frequency, measured frequency, cents deviation, and detected onset offset in milliseconds. Completed notes contribute to three separate metrics:

- **Pitch:** the proportion of voiced samples within ±20 cents of the written note. Silence is reported through coverage rather than included in this denominator.
- **Duration coverage:** voiced time divided by written note duration, including missed notes as zero coverage. Earlier measures are excluded when starting partway through a score.
- **Rhythm:** the proportion of detected onsets within ±150 ms of their written times, alongside the number of detected onsets. Missing attacks appear as **Not detected** in the note-by-note table and are not included in the rhythm percentage.

Onsets require a stable pitch change or a return after a gap. Repeated legato notes and bow changes cannot always be distinguished by a monophonic pitch detector. Browser input latency also affects timing; this feature provides practice feedback rather than a calibrated performance grade. Tests cover synthetic pitch, onset matching, silence, wrong notes, ties, tempo maps, part selection, and all supported import containers; they do not replace testing on real instruments and microphones.

MusicXML ties are merged for analysis, and score tempo changes are preserved. Playback follows written measure order without expanding repeats, endings, or navigation marks. Chords use the highest note of the selected voice. Grace notes are omitted from analysis. The notation still shows the source part; voice selection controls the analyzed line.

MIDI is converted to simplified notation, using one monophonic line per track. Simultaneous notes prefer the highest pitch; overlapping later notes are skipped. The first time signature determines bar grouping, and subsequent meter changes are not expanded. Prefer MusicXML when original notation, multiple voices, or complex rhythms matter. PDF/image recognition and adaptive following of rubato are not included.

The score UI and engraving library load on demand, keeping their download out of the initial tuner screen.

### Graded built-in score library

Score practice includes nine local MusicXML practice editions, with English and Chinese titles, difficulty filters, suggested slow tempos, and technique cues. Select **Score library**, choose a level, and press **Practice this piece**. Loading a piece does not start microphone recording. The library collapses after selection and can be reopened while paused. Importing a personal score continues to work independently.

The library includes Old 100th and Ode to Joy (beginner), Brahms’ Lullaby, Amazing Grace, the first section of Minuet in G and the Greensleeves ground theme (elementary), and opening excerpts of Red Apple Rag, Rieding's Op. 35 concerto and Martini's Gavotte (intermediate). Difficulty describes the included practice edition, not an exam grade. Complete source arrangements may be harder. Simplified editions omit accompaniment and some markings; every adaptation is identified in the UI.

Assets ship under the Pages base path and load from the app's own host without runtime requests to third-party score services. Each card and the selected score expose source attribution, license and a downloadable editable MusicXML file. See [`public/scores/SOURCES.md`](public/scores/SOURCES.md) for provenance, exact modifications, license terms, and rebuilding instructions. The source files and deterministic generator are included in the repository.

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

### Fullscreen score and floating cues

Both Score practice and Beginner practice provide **Fullscreen** in the notation toolbar. The complete horizontal ribbon stays mounted: entering or exiting fullscreen preserves the audio session, timing, results, and manual browsing state. Native browser fullscreen is requested when available; a viewport-filling layout works in mobile or embedded browsers that deny or do not implement the API. Use **Exit fullscreen** or Escape to return. Keyboard focus is contained within the expanded view, body scrolling is temporarily locked, and prior focus and scrolling are restored on exit or unmount.

The warm translucent performance overlay sits inside the score surface in either view, with reserved space that keeps it clear of the staff. It displays the current note/count-in, expected and measured frequency, cents deviation, detected onset offset, three upcoming notes, progress, and start/pause/restart controls. Beginner actions appear immediately above the staff, inside the score frame in both normal and fullscreen views. They show bow direction, string/finger, group/round and action beats, and remain visible when the lower note overlay is collapsed. Instructions and manual posture checkpoints stay outside the score. **Collapse cues** reduces the overlay while retaining the current note and transport controls. Short landscape screens use a compact layout. Errors opening the microphone remain visible inside fullscreen.

### Start at a note and keep the page steady

Double-click a note (or double-tap on touch screens) to start or continue from that written position, without a new count-in. The engraving's note coordinates and timestamps are used for selection, including after horizontal browsing or fullscreen changes. A new analysis segment begins at that point. Seeking while already playing reuses the active audio stream and moves the audio-clock origin; it does not request microphone access again. Normal start/restart retains the four-beat count-in, and restart returns to the selected note or bar. Selecting a bar while paused still positions the score without starting the microphone.

Current action and Play now use the same maximum width and responsive side insets. Start, pause, resume, and bar selection do not scroll the document vertically. Introductory text and controls retain their layout while playing, checkpoints expand/collapse only when requested, and transport buttons keep a fixed height across states. Browser scroll anchoring is suspended while either score practice view is mounted and restored on exit. Only the notation's horizontal viewport follows the current note.

## Vibe mode: continuous continuation and a performance notebook

Vibe is a sixth independent practice mode. Choose a tempo (40–120 quarter-note BPM) and either an estimated key or a fixed major/minor key, then press **Start Vibe**. Play two stable notes, or hold one note for about two beats. Generation begins while you continue playing; it does not wait for you to finish a phrase. Tempo and key are locked once a take has notes, so recorded timing and written beats stay consistent. Use **New take** to choose new settings.

Engine, tempo and key choices are saved immediately as browser-local defaults (`arco-vibe-preferences-v1`). New takes, mode re-entry and page reload restore those defaults. First use remains Rule-based, 60 BPM and automatic key. Invalid or unavailable stored values fall back field by field; storage failures leave the current choices usable and display a notice. Restoring Transformer selection never starts a weight download or GPU initialization: **Download / load model** remains explicit. Opening a historical take preserves its recorded tempo/key without replacing new-take defaults.

**Continuation engine** defaults to **Rule-based**, adapting recent melodic contour and rhythm without a model download. Pause a take to switch to **Transformer · SkyTNT W4A16**, then explicitly press **Download / load model**. The site hosts 144,494,146 bytes of converted weights as 16 MiB shards. Downloads show progress, support cancellation, and reuse SHA-256-verified shards in the browser Cache API on retry. Complete model checksums are verified again before inference. **Clear weight cache** removes only this model's cached shards. Cache availability and errors are visible; private browsing or storage pressure may require another download. WebGPU with `shader-f16` is required; unsupported devices can select Rule-based. ONNX Runtime and its matching Asyncify WASM/MJS assets load only after requesting the Transformer. Runtime assets add to the weight download size. See the [hosted model card](public/models/skytnt-tv2o-medium-w4a16-stable-v2/README.md).

Model readiness is tied to the active Worker, its loaded engine ID and the `arco-vibe-engine-v3` protocol. Messages from replaced Workers are ignored, and predictions use the engine actually loaded by the active Worker rather than a captured UI selection. A rules Worker cannot execute a Transformer request, and an absent decoder never reaches `.generate()`. The production Worker statically imports its small decoder, while ONNX Runtime and weights remain on demand. A lazy decoder chunk previously imported shared tokenizer functions from the Worker entry: Safari reevaluated that entry and replaced its message handler with a fresh, unloaded host. This reproduced in the minified production bundle on desktop Safari, despite succeeding in development and Chromium. The Worker build rejects any emitted chunk that imports a Worker entry, preventing this circular loading pattern from returning. After session creation it reports **loaded**, then the UI sends a separate **verify** Worker message. This runs a full four-bar self-test through the same production callback used by live predictions; only successful completion reports **Ready**. Test bars never enter the score or take history. This checks decoder persistence across message turns instead of only inside its loader. Failed initialization releases partial sessions and the GPU device. Errors include stable codes such as `MODEL_NOT_READY`, `ENGINE_MISMATCH`, `MODEL_PREFLIGHT_FAILED`, and `WEBGPU_DEVICE_LOST`. Retrying during recording saves and pauses the take, reloads the selected engine using verified cached weights, and reruns the self-test before resuming is available. These guards are covered by lifecycle regression tests; desktop Chromium WebGPU inference is tested, while iPhone hardware compatibility still needs device testing.

Both engines keep up to four future 4/4 bars in G3–B5. Every published bar is immutable, including future bars already visible. New requests extend the tail instead of revising the existing horizon. SkyTNT streams each complete bar to the UI while decoding the remaining bars; no unfinished measure is published. It uses recent captured notes and the generated tail as context, with token constraints enforcing one violin voice, range and exact requested bar count. Late results cannot replace old bars; missed timeline slots become explicit rests. Paused-session and stale-context results are discarded. Start waits for the selected engine to become ready. Inference errors are visible and never silently substitute another engine. JSON revisions include engine/version, inference time and context epoch. Changing engines requires pausing but preserves the take. Auto key estimation uses recent duration-weighted pitch classes and may be ambiguous. Neither engine uploads audio or calls a generative API.

The live ribbon retains the complete generated score throughout the take, with absolute measure numbers, fullscreen and horizontal browsing. Immutable bars own independent SVG engravings; only appended bars are newly engraved. Existing SVGs, playhead, fullscreen and manual scroll state remain mounted, without full-score loading messages, opacity animations or resets to the left edge. New engravings are scheduled across frames, and staff baselines are aligned across independently laid-out measures. A floating note panel shows the suggestion, measured pitch, upcoming notes and pause/resume controls. After pausing, **View your performed score** opens a separate notation of what was actually played.

**Clear continuation context** resets only future prediction input. It preserves the take, captured notes, elapsed time, published score, history, settings and loaded model; it works during recording or while paused. Existing generation is canceled and its late messages rejected using a new context epoch. New prompts use only notes played after the reset, clipping a held note at the reset timestamp. Pre-reset generated bars are excluded from the primer. A fresh phrase is required before extending the existing immutable tail. The reset timestamp and epoch are recorded in JSON. Use **New take** to start a separate take instead.

Microphone analysis uses the app's 48 kHz / 4,096-sample detector at approximately thirty analyses per second. A candidate needs at least three readings spanning 80 ms. Pitch hysteresis avoids splitting moderate vibrato into adjacent notes, and gaps over 180 ms separate repeated pitches. Recognized notes retain unquantized onset/duration and average detected frequency; notation rounds onto an eighth-note grid at the selected tempo and fills rests and ties. Very fast passages, repeated legato notes, bow changes and noisy input can be missed. The initial A4 reference is retained for the take. This is a monophonic practice transcription, not a calibrated recording or technique assessment.

Takes are limited to ten active minutes each and saved in browser IndexedDB (`arco-vibe`, `sessions`) every eight seconds, on pause, and when the mode is left or the page is hidden. Pausing releases the microphone. Continuing a take excludes paused wall-clock time. The current draft survives mode changes within the app; **Takes** restores saved sessions after a reload. Storage failures are reported with a download fallback; browser data can be cleared by browser settings, so export important takes. Raw audio is never stored.

Three downloads preserve different views:

- **Performed MusicXML:** the quantized transcription of recognized notes, including silence.
- **Generated MusicXML:** the latest written continuation plan, including unplayed future suggestions; it is not labeled as the user's actual performance.
- **Full JSON record:** raw note times and frequencies, tempo, key/reference settings, the continuation plan, and every published revision with its publication beat and first changed bar. Generated bar indices in JSON are zero-based; displayed measure numbers are one-based.

Persistence writes are serialized so an older autosave cannot overwrite a later paused take. Deleting a take removes that local record. Tests cover sustained/vibrating tones, short glitches, silence gaps, repeated notes, high violin pitches, deterministic continuation, full bars, protected lookahead, revisions, quantization, rests, ties, and window numbering. Browser verification uses synthesized input to exercise generation, persistence across reloads, mode changes, exports and responsive layouts without recording from a real microphone.

## Sampled violin playback

The reference-tone button uses real bowed solo-violin multisamples instead of a triangle oscillator. It plays for three seconds at the current target and A4 reference. Starting microphone tuning or changing the target/mode cancels playback, including pending sample loads.

**Listen to score** is available in score and beginner practice, including the fullscreen HUD. It plays the selected part/voice from the current position at the chosen practice tempo, or follows score tempo changes when no override is selected. Tied notes retain their duration and rests stay silent. Pause/resume preserves the score clock; stop cancels queued notes. While auditioning, double-click a note to seek and continue listening. Starting microphone practice stops playback and starts fresh analysis at the current position, so previewed notes never become measured performance results. Practice settings are locked while audio is playing or loading. Paused playback can be changed or canceled.

**Listen to continuation** in Vibe plays the entire currently generated plan, beginning at its first generated bar without an artificial opening wait. The score, playhead and upcoming-note cues follow audition time; captured elapsed time, notes and revisions remain unchanged. Stop returns to the live position in the same retained score. Saved takes can also be auditioned. Pause recording before listening; starting Vibe recording cancels audition playback. Auditioning reuses the same engraved bars; it does not rebuild the score or modify the performance record.

Playback uses the AudioContext clock and a 25 ms lookahead scheduler, independent of React paints. Pause, stop, mode changes, page hiding and unmount cancel queued voices, with short gain releases to avoid clicks. Sustained notes use crossfaded sample loops; paused sustained notes resume from their sample offset. Samples load only for required pitch roots, and decoded buffers are reused in the shared AudioContext. The first playback needs the relevant sample downloads (roughly 125 kB per root; ten roots total about 1.25 MB). Errors offer retry without substituting an oscillator. Playback uses no microphone permission.

Samples derive from [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), under CC0 1.0. See [license, credits and processing details](public/audio/violin/README.md). The recorded vibrato remains audible; median root frequencies are measured and compensated to the selected A4. A sampled violin is a musical pitch guide, not a precision calibration tone.
