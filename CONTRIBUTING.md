# Contributing to CiteFox

Thank you for helping. CiteFox is a source-available desktop app (Electron, React and TypeScript) by Space-O Technologies. Issues, ideas and pull requests are all welcome.

By sending a pull request you agree to section 5 of [`LICENSE`](LICENSE): you confirm you have the right to send it, you keep your copyright, and you give Space-O Technologies a perpetual licence to use, change and relicense your contribution as part of CiteFox. Please add `Signed-off-by: Your Name <email>` to your commits (`git commit -s`) to confirm this.

Bug reports and ideas go in GitHub Issues. Security problems do not: see [`SECURITY.md`](SECURITY.md).

## How the code is split

| Path           | What lives there                                                        | Rule                                                          |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/main`     | Scheduler, cloro, SerpApi, Jina, Claude, Codex, SMTP, storage, keychain | Talks to the outside world and the disk                       |
| `src/renderer` | The window: every screen                                                | Never talks to the outside world directly                     |
| `src/preload`  | The IPC bridge                                                          | Expose the IPC allow-list and nothing else. No business logic |
| `src/shared`   | The IPC contract and shared types                                       | Change it first, then both sides                              |

A change to the IPC contract or a shared type happens in `src/shared` first. Main and the renderer then update against that contract. A contract change that does not compile on both sides is not ready.

`Docs/` is the behaviour spec. If code and spec disagree, say so in the pull request rather than quietly editing the spec to match.

## Setup

Node.js 24.19 or newer (`nvm use` reads `.nvmrc`), then `npm ci`. No compiler toolchain is needed: the native modules ship N-API prebuilds.

Before a pull request:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build        # test:unit checks the built bundle in out/
npm run test:unit
npm run test:e2e:docker -- tests/e2e/<spec>.ts   # the specs you touched, in Docker
```

CI (`.github/workflows/ci.yml`) runs all of these, plus the full e2e suite, on macOS, Windows, and Linux.

### Run the e2e suite in Docker so no app windows open on your screen

Every e2e spec launches the Electron app. On your own machine those windows appear on your screen and can take focus. To run the suite out of sight, use Docker:

```bash
npm run test:e2e:docker                              # full suite
npm run test:e2e:docker -- tests/e2e/shell.spec.ts   # some specs (arguments go to Playwright)
npm run test:e2e:docker -- --rebuild                 # rebuild the image first
```

Prerequisite: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or another Docker engine), running. Nothing else: Node, Electron, and Playwright's Chromium are installed inside the container.

`scripts/e2e-docker.mjs` builds `docker/e2e.Dockerfile` once as `citefox-e2e:node24.19` (Ubuntu 24.04, Node from `.nvmrc`, Electron's libraries, xvfb, gnome-keyring). Each run starts a fresh container, copies in your working tree (tracked files plus untracked files git does not ignore; never `node_modules`, `out`, `.env` files, or `.claude` folders), runs `npm ci` and the suite under xvfb, copies `test-results/` (traces, screenshots, error context) back, prints the Playwright summary, removes the container, and exits with the suite's exit code. The npm, Electron, and Chromium downloads are cached in two named volumes, so reruns are much faster than the first run. The packaged-app spec skips, as it does without `CITEFOX_PACKAGED_APP`.

To clean up:

```bash
docker rmi citefox-e2e:node24.19
docker volume rm citefox-e2e-npm citefox-e2e-cache
```

`npm run format` rewrites formatting. Do not reformat `Docs/`.

## Tests

Tests run offline. They must not call cloro, SerpApi, Claude, Codex, Jina, YouTube, or SMTP, and they must not need API keys. Recorded, redacted fixtures (`src/main/providers/fixtures/`, `src/main/assist/fixtures/`) stand in for the services, and the e2e specs put a stand-in `claude` program on `PATH` (`tests/e2e/claude-shim.mjs`).

The e2e launcher (`tests/e2e/launch.ts`) keeps every test away from your own setup: each launch gets a temporary data folder, keys go to a file in that folder instead of your keychain (`CITEFOX_SECRETS_FILE`), and only the stand-in AI programs in the temp folder are found (`CITEFOX_E2E_FAKE_AI_ONLY=1`), never the real `claude` or `codex`. Use `launchCiteFox` for any new spec so it gets the same protection.

To run a second copy of the app from source beside your usual one, give it its own data folder with `CITEFOX_USER_DATA` (see the README).

## Secrets

Secrets live only in the system keychain (macOS Keychain, Windows Credential Manager, or libsecret). That includes cloro, SerpApi, Jina, Anthropic, and YouTube keys, SMTP passwords, and Slack webhook URLs.

Never commit `.env` files, key material, account exports, logs, local databases, or Claude Code / Codex session folders (`.claude/`). `.gitignore` covers the usual ones. Logs, error reports, and project exports must redact secrets. Settings and SQLite files store a keychain reference, not the secret.

## Pull requests

Keep a pull request to one change, with tests. If it covers a requirement in `Docs/` (for example `FR-11.11` or `NFR-16`), name the id.

Versions follow semantic versioning. User-facing changes go in `CHANGELOG.md`. Releases are described in `Docs/RELEASING.md`.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). `npm run release` turns them into the changelog, so write the subject for a CiteFox user: what changed for them, in plain words.

```
<type>(<optional scope>): <what changed, for the user>

<optional body: why, and anything a reviewer needs>
```

| Type       | Use it for                                | In the changelog |
| ---------- | ----------------------------------------- | ---------------- |
| `feat`     | Something new a user can see or do        | New              |
| `fix`      | A bug fix                                 | Fixed            |
| `perf`     | Faster or lighter, same behaviour         | Faster           |
| `refactor` | Code change with no behaviour change      | left out         |
| `docs`     | Documentation only                        | left out         |
| `test`     | Tests only                                | left out         |
| `build`    | Packaging, dependencies, electron-builder | left out         |
| `ci`       | GitHub Actions                            | left out         |
| `chore`    | Anything else that users never notice     | left out         |

A breaking change (data moved, a setting removed, an older CiteFox can no longer open the data) gets a `!` after the type, or a `BREAKING CHANGE:` line in the body. It is listed first, under Important.

Examples:

```
feat(reports): share a report as a link
fix: the Summary chart no longer cuts off the last day
perf(checks): run three questions of a market at once
feat(storage)!: move projects to one database file
```

Keep the subject under about 72 characters, in the imperative ("add", "fix", not "added"), with no full stop. Commits without a type still work and land under "Other changes", but please use one.

## Build from source

Everything a developer needs to run, test and package CiteFox. The README has the short version.

### Run it from the source code

This is the quickest way to try CiteFox today, and the way to work on it.

1. Install **Node.js 24.19 or newer**. With [nvm](https://github.com/nvm-sh/nvm), run `nvm install` in the CiteFox folder; it reads the version from `.nvmrc`.
2. In the CiteFox folder, install the packages:

   ```bash
   npm install
   ```

3. Open the app:

   ```bash
   sh scripts/try.sh
   ```

   `try.sh` opens CiteFox with live reload: changes you make to the code show in the window within seconds. It keeps its data in its own folder (`~/Library/Application Support/CiteFox Dev` on a Mac), so it never touches an installed copy of CiteFox. `npm run dev` does the same with the default data folder.

The first window walks you through setup. You need one AI program and one search key, both described below.

#### Pick your AI: Claude Code or Codex

CiteFox uses an AI program that is already on your computer to read your site and write buyer prompts, profiles and reports. It runs under your own plan, so CiteFox never sees or stores your sign-in.

- **Claude Code**: install it from [claude.com/claude-code](https://claude.com/claude-code) and sign in once in a terminal (`claude`). It runs on your Claude plan.
- **Codex**: install the OpenAI Codex CLI and sign in once in a terminal (`codex login`). It runs on your ChatGPT plan.

Pick one on setup step 2 ("AI"). CiteFox checks that the program is installed, signed in, and gives a test reply. You can switch later in **Settings › Connections › AI**. An Anthropic API key also works, for client work or a shared computer (see [Terms](Docs/AI-PROVIDERS.md#terms-of-the-services-you-connect)). [`Docs/AI-PROVIDERS.md`](Docs/AI-PROVIDERS.md) explains how each one is used and locked down.

No AI program? Step 3 offers **Use my own ChatGPT**: CiteFox gives you one prompt to paste into ChatGPT, and reads the answer you paste back.

#### Keys you need

All keys are your own. CiteFox never shares them and never sends them anywhere except to the service they belong to.

| Key             | What it is for                                                                                  | Needed?                           |
| --------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| **cloro**       | Asks Google AI Overviews, Google AI Mode, ChatGPT, Perplexity, Gemini and Copilot, with one key | One of cloro or SerpApi is needed |
| **SerpApi**     | Asks Google and reads its AI Overview (Google AI Overviews only)                                | One of cloro or SerpApi is needed |
| **Jina Reader** | Reads pages that build their content with JavaScript                                            | Optional                          |

Both cloro and SerpApi have free plans to try CiteFox. Setup step 7 links to each sign-up page and tests the key before saving it. CiteFox shows how many searches or credits each check will use before it spends any, and stops before a monthly budget you set.

**Where keys are kept.** Keys, SMTP passwords and Slack webhook links are stored only in your system keychain: the macOS Keychain, Windows Credential Manager, or the Secret Service on Linux. CiteFox's database and settings files keep only a reference to the keychain item, never the key itself.

#### Setup

You need **Node.js 24.19 or newer** (`.nvmrc` pins 24.19.0). Older Node versions break Playwright and exceljs, so npm refuses to run with them.

```bash
nvm use            # or install Node 24.19+ another way
npm ci
npm run dev        # opens CiteFox with renderer hot reload
```

No compiler toolchain is needed. better-sqlite3 and @napi-rs/keyring ship N-API prebuilds that load in both Node (for tests) and Electron.

`npm run dev` talks to the real engine. To use the in-memory mock client in dev, open DevTools in the window, run `localStorage['citefox.client'] = 'mock'`, then reload. To load the demo sample catalog as well, also run `localStorage['citefox.mock.catalog'] = 'textbolt'`. A release build ignores both flags and does not contain the mock code.

#### Scripts

| Script                     | What it does                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start Electron with renderer hot reload                                                             |
| `npm run build`            | Compile main, preload, and renderer to `out/` (minified renderer)                                   |
| `npm start`                | Open the built app                                                                                  |
| `npm run typecheck`        | `tsc` for the main and renderer projects                                                            |
| `npm run lint`             | ESLint                                                                                              |
| `npm run format:check`     | Prettier check (`npm run format` rewrites)                                                          |
| `npm run test:unit`        | Vitest unit tests                                                                                   |
| `npm run test:e2e`         | Headless `--check-due` tests, then a build with `VITE_CITEFOX_E2E_MOCKS=1` and the Playwright suite |
| `npm test`                 | A production build, unit tests, then the e2e suite                                                  |
| `npm run test:e2e:docker`  | The e2e suite inside Docker, so no app windows open on your screen (see below)                      |
| `npm run smoke:live`       | One real check against live services. Opt-in. See `Docs/SMOKE.md`                                   |
| `sh scripts/try.sh`        | Quick test-and-fix: opens CiteFox from the source with live reload, on its own "CiteFox Dev" data   |
| `npm run pack`             | Build and package an unpacked app in `release/` (no installer)                                      |
| `npm run dist`             | Build installers for the current OS and arch in `release/` (keeps only this version's installers)   |
| `npm run dist:mac`         | macOS DMG (`dist:win` gives an NSIS installer, `dist:linux` an AppImage and a .deb)                 |
| `npm run release -- minor` | Bump the version, write the changelog, commit and tag (never pushes; see `Docs/RELEASING.md`)       |

Tests run offline and never need real API keys. On Linux without a display, the e2e runner wraps Playwright in `xvfb-run`. The e2e launcher (`tests/e2e/launch.ts`) sets `CITEFOX_SECRETS_FILE` to a file in each run's temporary data folder, so keys and passwords a test saves go there and never into your real keychain. An unpackaged build reads that variable; a packaged app ignores it and always uses the keychain. The launcher also sets `CITEFOX_E2E_FAKE_AI_ONLY=1`, so the app only finds the specs' stand-in `claude` and `codex` programs (in the temp folder) and never runs the real ones installed on your computer. To run a single spec: `npx playwright test tests/e2e/<spec>.ts`, after building with `VITE_CITEFOX_E2E_MOCKS=1 npx electron-vite build` (or `CITEFOX_E2E_SKIP_BUILD=1 npm run test:e2e` to reuse that build). `npm run test:unit` includes one check of the built bundle, so run `npm run build` once first in a fresh clone.

#### Run a second copy from source

`sh scripts/try.sh` and `npm run dev` keep their data in one folder (`try.sh` uses `~/Library/Application Support/CiteFox Dev`). To run another copy beside it, for example from a second checkout, give it its own data folder and debug port:

```bash
CITEFOX_USER_DATA="$HOME/citefox-second" CITEFOX_TRY_DEBUG_PORT=9334 sh scripts/try.sh
```

`CITEFOX_USER_DATA` moves the whole data folder (database, settings, logs, window state, and the lock that allows one window per folder). Keys you add in that copy are still new keychain items; to keep them out of the keychain too, also set `CITEFOX_SECRETS_FILE` to a file path (it is plain text, so use it only for test keys). Only unpackaged builds read it; an installed app ignores it. The e2e launcher removes it, so tests always get their own temporary folders.

#### Testing installed builds

The header shows the version, the commit and the build date, so you can tell test builds apart. The build menu has two tools for testing the first run on an installed app:

- **Reset CiteFox, keep my keys** turns off background checks and open at login, then restarts. Before storage opens, the next start moves every project, setting and history file into `<data folder>/backups/reset-<time>/` (only the newest reset backup is kept). It then creates fresh data and puts the API key records back, without project links. The keys' keychain items are never read or removed, so onboarding opens on the profile step with the saved keys already done. Logs stay. If a step fails, the original files go back and the app opens as it was. To undo a reset, quit CiteFox and move the backup's files back into the data folder.
- **Test as a new user** opens a second CiteFox on its own data folder (`<appData>/CiteFox Test Profile`) with its own keychain service (`CiteFox Test`). It never installs the background job or the login item, which the real install shares by name. Opening it again focuses the open test window. **Start fresh** deletes that folder and every `CiteFox Test` keychain item, but only while no test window is open. It never touches the real `CiteFox` items or data.

An unpackaged build (`npm run dev`, e2e) uses a recorded stand-in for both tools. It never restarts, moves data or opens a window, and it writes each call to `<userData>/e2e-app-tools.jsonl`. Set `CITEFOX_E2E_APP_TOOLS=fail` to make the stand-in fail, or `CITEFOX_E2E_APP_TOOLS=real` to run the real tools from a dev build. A packaged app ignores the variable.

#### Packaging

`npm run dist` produces an unsigned build unless signing credentials are in the environment. It applies Electron fuses (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, ASAR integrity checks, app loaded only from `app.asar`). To smoke-test a packaged build:

```bash
npm run dist:mac
CITEFOX_PACKAGED_APP=release/mac-arm64/CiteFox.app/Contents/MacOS/CiteFox \
  npx playwright test tests/e2e/packaged.spec.ts
```

Signed and notarized releases, versioning, and CI release builds are covered in [`Docs/RELEASING.md`](Docs/RELEASING.md). The app icon in `build/icon.svg` is a placeholder (`npm run icon` re-renders `build/icon.png`).

#### Layout

| Path           | What lives there                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `src/main`     | Electron main process: engine, scheduler, providers, storage, keychain, logging                       |
| `src/preload`  | The IPC bridge. It exposes the shared allow-list and nothing else                                     |
| `src/renderer` | The React window                                                                                      |
| `src/shared`   | IPC contract and shared types                                                                         |
| `tests/e2e`    | Playwright tests that launch the built app                                                            |
| `Docs/`        | Spec (SRS), report spec, architecture, IPC, milestones, launch checklist, smoke-test and release docs |

`Docs/ARCHITECTURE.md` explains the process split and IPC rules. `CONTRIBUTING.md` has the pull request checklist.
