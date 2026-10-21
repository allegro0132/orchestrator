# ARCO · Violin Tuning Studio

A responsive React violin tuner with English and Chinese support, faster pitch tracking, a separate metronome practice mode, and local MusicXML/MXL/MIDI score practice with live pitch and timing analysis. The application source lives in [`violin-tuner`](violin-tuner).

## Development

```sh
cd violin-tuner
npm ci
npm run dev
```

## Checks

```sh
npm run format
npm run format:check
npm test
npm run build
```

## GitHub Pages

The [CI and GitHub Pages workflow](.github/workflows/pages.yml) checks formatting, runs tests, and builds every pull request. Pushes to `main` also publish the application to GitHub Pages:

https://allegro0132.github.io/orchestrator/

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Deployment uses the built-in `GITHUB_TOKEN` and requires no personal access token or repository secret.

The workflow sets `VITE_BASE_PATH=/orchestrator/` for project-site assets. Ordinary local and Sites builds keep `/` as their base. To reproduce the Pages build locally:

```sh
cd violin-tuner
VITE_BASE_PATH=/orchestrator/ npm run build
VITE_BASE_PATH=/orchestrator/ npm run preview
```

Microphone input requires HTTPS or localhost. Audio stays on the device.
