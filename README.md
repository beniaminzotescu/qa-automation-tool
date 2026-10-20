# QA-ASD-STE100

Windows desktop app (Electron + React + TypeScript) that lets non-technical users write
Playwright tests in plain English. See [PLAN.md](PLAN.md).

## Run it

```
npm install
npm run setup:electron   # only if `npm run dev` says the Electron binary is missing
npm run dev              # app with hot reload
```

Other commands: `npm run typecheck`, `npm run build`, `npm start` (runs the built app).

## Layout

| Folder | What |
|---|---|
| `src/main/` | Electron main process: windows, IPC, secrets, Claude calls |
| `src/preload/` | The safe bridge (`window.api`) between the UI and the main process |
| `src/shared/` | Types shared by both sides (`api.ts` is the IPC contract) |
| `src/renderer/` | React UI (`screens/`) |

Secrets (the Claude API key, later the platform credentials) are encrypted with Windows DPAPI
via Electron `safeStorage` and kept in `%APPDATA%\test-framework-builder\secrets\`.

## Installer and updates

- `npm run dist` builds the installer people get: `dist/nsis-web/QA-ASD-STE100-Setup-<version>.exe` (under 1 MB). It
  shows a wizard (only for me / all users, install folder), downloads the app from the GitHub release with a progress
  bar, installs it, and offers to start it. If the app is already installed, it updates it and keeps the user's data.
- `npm run dist:offline` builds the full installer for computers without internet:
  `dist/QA-ASD-STE100-Offline-Setup-<version>.exe`.
- Not code-signed yet: on first install Windows shows "Windows protected your PC"; click **More info → Run anyway**.
- `npm run icons` redraws the icon and installer images in `build/` from `scripts/make-icons.mjs`.
- The installed app checks GitHub Releases (`beniaminzotescu/qa-automation-tool`, see `electron-builder.yml`) when it starts,
  downloads a newer version in the background and offers **Restart now**.

To publish a new version:
1. Raise `version` in `package.json` (for example 0.1.0 → 0.2.0). The app only updates to a higher version.
2. Set a GitHub token with permission to create releases: `$env:GH_TOKEN = "<token>"`.
3. `npm run release`. It uploads the web installer, the app package (`.nsis.7z`) and `latest.yml` to a draft release on GitHub.
4. On GitHub, publish the draft release. Installed apps pick it up the next time they start.

The repository must be public for the app to see releases without a token.
