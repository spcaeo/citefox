# Architecture

CiteFox is an Electron 44 desktop app written in TypeScript, with a React 19 window. The behaviour spec is `Docs/AI Overview Visibility Tracker — SRS.md` v2.0; the report spec is `Docs/REPORT-SPEC.md`; the buyer-prompt method is `Docs/textbolt-reference.md`. CiteFox tracks Google AI Overviews only. This file says how the code is split and where each part lives.

## Processes

| Part | Where | Role |
| --- | --- | --- |
| Main | `src/main/index.ts` | Storage, keychain, providers, check engine and runner, queue, scheduler, setup runner, sitemap sync, email, exports. Long work runs here, never on the window thread (NFR-17) |
| Renderer | `src/renderer/` | Sidebar, page tabs, and every screen. Sandboxed, no Node.js |
| Preload | `src/preload/index.ts` | Refuses to start without context isolation. Exposes `window.citefox`, built from the IPC allow-list, and nothing else |
| Tray | `src/main/tray/` | Same main process. Menu (Open, Ask, Check due, Pause today, Resume, Settings, Quit), the due-pass tick, wake catch-up, desktop notifications. Closing the window hides it; checks keep running |
| Headless | `src/main/headless/` | The same executable started as `citefox --check-due` by the OS job. No window, no Dock icon |

Startup (`index.ts`): set the app name (`CiteFox`, so the data folder matches the SRS) and the AppUserModelId `app.citefox.desktop`, create the logger, take the single-instance lock, then on ready open storage, the keychain store, transports, the check engine and runner, install the content guards, register IPC, install the tray, resume interrupted checks and open the window. The sitemap sync loop and the setup runner start when the window host is up and stop on quit. If startup fails, `startup-error.ts` shows why and the log path instead of quitting silently; data written by a newer CiteFox is refused with a message to update.

Single instance (`headless/single-instance.ts`): a second normal launch focuses the existing window. `--check-due` exits at once if another instance holds the lock. If the user opens CiteFox while `--check-due` is running, the pass stops after the current page, relaunches without the flag and exits.

The headless pass runs, within a 2-minute budget (`HEADLESS_MAX_WAIT_MS`): due page checks, then automatic exports for the projects they touched (FR-22.6), then due sitemap syncs and background page setup (`background-pass.ts`), then due weekly and monthly reports (`due-reports.ts`). Work that does not fit waits for the next hourly run. Exit codes: 0 ok or nothing due, 1 a check failed, 2 a cap stop.

## Source layout

| Path | What lives there |
| --- | --- |
| `src/shared` | IPC contract (`ipc/`), domain types (`domain/`), report copy and template syntax. Imported by all three targets; it must not import Electron, Node or React |
| `src/main/storage` | SQLite files, migrations, repositories |
| `src/main/engine`, `pipeline` | Page read, buyer profile, prompts, coverage, checks, scoring, progress, sentiment |
| `src/main/providers` | Claude Code, Anthropic API, SerpApi, Jina, YouTube, pinned HTTP |
| `src/main/queue`, `scheduler`, `tray`, `headless` | Check queue, due planner, OS job, tray, `--check-due` |
| `src/main/setup-runner`, `notices` | Background page setup, "ask me" notices and cap alerts |
| `src/main/structure`, `communities`, `analytics` | Sitemaps and clusters, Communities and YouTube, answer shapes |
| `src/main/export`, `email` | Report model and renderers, SMTP, Slack, scheduled reports |
| `src/main/assist`, `ask`, `llm` | AI assists, Ask CiteFox, the Claude call log |
| `src/main/permissions` | "What CiteFox needs": consent file, the OS seam (notifications, login item) and the `permissions:*` service (`src/shared/permissions/` holds the pure checklist mapping) |
| `src/main/topics` | Topics: wizard drafts, site reads, topic templates and steps, page matching, estimate and start, batches, results (`src/shared/topic-scoring.ts`, `topic-results.ts`, `topic-depth.ts` hold the pure rules) |
| `src/main/start` | First-run "Your site" homework: sitemap sections, the page shortlist and address rules, one Claude pick of first pages and topics, the saved plan, sitemap suggestions for Add page (`src/shared/site-start.ts` holds the plan estimate) |
| `src/main/handlers` | IPC handlers per area |
| `src/renderer/src` | One folder per screen; shared pieces in `components/`, `drill/`, `grid/`, `shell/`. `mocks/` and `*.sample.ts` are dev-only and kept out of a release build |

## Toolchain

npm is the package manager; the lockfile makes installs repeatable. Node.js 24.19 or newer is required (`.nvmrc`). [electron-vite](https://electron-vite.org) builds main, preload and renderer as three Vite pipelines. The template defaults (`sandbox: false`, a general IPC bridge) are not used: NFR-16 requires context isolation, a sandboxed renderer, no Node integration and a typed allow-list. TypeScript is strict (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`), so a broken IPC contract fails `npm run typecheck` on both sides. ESLint 9 and Prettier use the electron-toolkit configs. Vitest runs unit tests in Node without Electron; better-sqlite3 and `@napi-rs/keyring` ship N-API prebuilds, so no native rebuild is needed. Playwright drives the built app for e2e tests, offline and without API keys. electron-builder packages installers (see Packaging).

## Data

All data is local, in the app data folder (`~/Library/Application Support/CiteFox`, `%APPDATA%\CiteFox`, `~/.config/CiteFox`):

| File | Holds |
| --- | --- |
| `app.sqlite` | Projects, API key metadata, connections, templates and their versions, queue pause, key usage, activity, email accounts, report schedules and deliveries, notices, setup runner settings, app-level `llm_calls` |
| `projects/<slug>.sqlite` | One project: profile, markets, pages, snapshots, buyer profiles, prompt sets, coverage, schedule and caps, check runs and captures, fixes and notes, site structure, sentiment, communities and video ideas, template overrides, answer shapes, page setup jobs, automatic exports and their runs, project `llm_calls` |
| `settings.json` | App settings |
| `window-state.json` | Window size and position |
| `logs/citefox.log` | Rotating log (see Logging) |

SQLite is opened with better-sqlite3, `foreign_keys=ON` and WAL; files are created 0600 and folders 0700 (`storage/database.ts`). Migrations (`storage/migrate.ts`) are numbered from 1 with no gaps, run forward only, and each runs in one transaction with its `schema_migrations` row. A migration that rebuilds a table other tables reference sets `foreignKeysOff`: foreign keys are switched off outside the transaction and `PRAGMA foreign_key_check` must show no newly broken reference before the commit. Before a migration that rebuilds tables on an existing file, a `VACUUM INTO <file>.before-migration` copy is kept. A database or `settings.json` from a newer CiteFox is refused.

| Database | Migrations |
| --- | --- |
| App (`APP_MIGRATIONS`, `storage/app-database.ts`) | 001–021: core tables, Claude checkups, onboarding, API key state and plans, named templates, active project, tray history, day pass, email tables and throttles, report schedules, multiple keys, queue pause, usage kept on project delete, activity events (018), open template kinds (019), template versions and `llm_calls` (020), notices and setup runner (021) |
| Project (`PROJECT_MIGRATIONS`, `ensureProjectSchema`) | 001–033: profile, pages and prompts, template names, pin order, active prompt set, schedule and caps, first and last check per market, fix follow-ups, alert settings, check runs, analyses, query indexes, notes and fix jobs (016), project options (017), site structure (018), saved views and ignored citations (019), brand sentiment (020), communities and video ideas (021), template overrides and `llm_calls` (022), answer shapes (023), page setup jobs (024), automatic exports (025), Reddit thread excerpts (026), topics: page kind and nullable URL (027, a rebuild with foreign keys off), topic tables (028), topic summaries (029), first-run "Your site" plan (030), buyer context (031), first-run edits (032), automatic page setup: first check waits and check when ready (033) |

### Project database

Each project is one SQLite file, `projects/<slug>.sqlite`. Pages, snapshots, buyer profiles, prompt sets, and coverage runs live in that file. A page row has no `project_id` column: the file is already one project. `PageSummary.projectId` is filled from the project context when the row is read.

`generations` (project database) records one row per model attempt for a buyer profile, prompt set or coverage matrix, and for the check-report steps (`aio_gap`, `summary`, `answer_shape`) and the sentiment reads, including failed validation attempts: kind, template id and SHA-256 hash, start time, duration, input, output and cache token counts, model, connection (`claude-code` or `anthropic-api`), ok, redacted error, an input hash (template hash, rendered prompt and schema) and the validated JSON. Cached generations are keyed by model and connection. Cost is not stored. The daily and monthly Claude call caps (`completeStructured`, `GenerationCallCaps`) count these rows, so every report-runner Claude call, answer shapes included, counts toward the same caps and per-page usage.

### Projects at scale

| Store | Holds |
| --- | --- |
| App migration `018_activity_events` | `activity_events`: one timestamped row per SerpApi capture (`count` = searches), Claude call, or Jina read, plus Claude limit, Claude fallback, and Jina failover notices in plain words. `key_id` has no foreign key; `project_id` is set to NULL when the project is deleted. Rows older than 70 days are removed on write. Feeds `connections:activity` and Claude calls per project |
| Project migration `017_project_options` | `project_options` (one row): Claude connection, key, fallback, fallback key, model, default samples. A missing row is the defaults. It is separate from `project_settings` because `writeProjectProfile` replaces that row. Its `template_overrides` column is legacy and unused: Project settings' template choices are versions in `template_overrides` (project migration 022), saved by `engine/project-settings/template-choices.ts` and copied by Copy settings |

The project's search cap, cap rule, and dedicated key stay on `project_schedule` (project migration 008). A dedicated key's `api_keys.project_ids` is set to that one project, so shared rotation skips it.

`engine/claude.ts` resolves every Claude call for a project: Settings, the Claude Code login, or a named Anthropic key, with the project's model, wrapped by `engine/claude-fallback.ts` for the project's rule (FR-11.7, LLM-10). Each connection below the fallback rule is wrapped once by `llm/call-log.ts` (`withCallLog`), so every call that reaches Claude, including a switched-to key, writes one `llm_calls` row (FR-25.6). Assists, Ask CiteFox, Try it, sentiment and video briefs pass their project id, and the assist label (`assist/label.ts`) names the project's connection. `index.ts` passes `claudeFor(projectId)` to the check engine, so each job's reports use its project's connection; a report stopped by a limit is written again later by the report runner.

## IPC contract

The contract lives in `src/shared/ipc/`. Each channel is declared once, in the spec record of its area module:

```ts
// src/shared/ipc/keys.ts
export const keysChannels = {
  'keys:add': invokeWith<AddApiKeyRequest, ApiKeyMetadata>(), // one argument
  'keys:list': invoke<ApiKeyMetadata[]>() // no arguments
} as const satisfies InvokeChannelSpecs

// src/shared/ipc/checks.ts
export const checksEvents = {
  'checks:progress': push<CheckProgress>() // main pushes, the renderer subscribes
} as const satisfies PushChannelSpecs
```

An area module (one per row of the table below) holds that area's request and response types, its `…Channels` record, and its `…Events` record if it has push events. Domain types used across areas are in `src/shared/domain/<area>.ts`. `@shared/ipc` and `@shared/domain` re-export every module. `ipc/contract.ts` holds the `invoke`, `invokeWith`, and `push` helpers.

| Area | Channels for |
| --- | --- |
| `app`, `settings`, `onboarding` | App name and version, app settings, first-run onboarding |
| `connections`, `keys`, `status` | Connections, Claude Code checkup and terminal, API keys, status capsule |
| `permissions` | "What CiteFox needs": the permissions and connections checklist and its one-click actions |
| `projects`, `projectSettings` | Projects, fill from website, project settings, duplicate, delete, usage |
| `pages`, `prompts`, `coverage` | Pages, pins, page read, buyer profiles and prompt sets, content-gap matrix |
| `setup`, `notices` | Background page setup, "ask me" notices |
| `checks`, `results`, `queue`, `schedule`, `tray` | Check jobs and progress, results and scores, the check queue, re-check schedules and the due list, tray line and menu |
| `fixes`, `history` | Progress fixes and follow-ups, history and notes |
| `sentiment`, `communities` | Brand sentiment; Communities and YouTube |
| `allpages`, `grid`, `structure` | All pages and bulk actions, saved grid views and CSV, sitemaps, clusters, silos and groups |
| `templates`, `playground`, `llm`, `assist`, `ask` | Generation templates, Try it, the Claude call log, AI assists, Ask CiteFox |
| `topics` | Topics and keywords & groups: drafts, wizard steps, estimate, start, results (Docs/TOPICS-SPEC.md) |
| `start` | First-run "Your site" homework, its live progress, and sitemap suggestions for Add page |
| `email`, `alerts`, `reports`, `exports` | Sending accounts, alert settings, scheduled reports and deliveries, exports |

`Docs/IPC.md` lists every channel.

`src/shared/ipc/index.ts` merges the records and derives the rest. Do not edit these by hand:

- `IpcInvokeMap` and `IpcEventMap`, the type maps.
- `IPC_INVOKE_CHANNELS`, `IPC_EVENT_CHANNELS`, and `IPC_CHANNELS`, the runtime allow-list. `src/main/ipc.ts` registers `ipcMain.handle` only for `IPC_INVOKE_CHANNELS`. Preload rejects any other name.
- The arity table. Main rejects a call with the wrong number of arguments. The error names the channel only.
- `createCiteFoxApi`, which preload exposes as `window.citefox`. The renderer calls `window.citefox['keys:add'](request)` and never imports `ipcRenderer`.
- `callIpcHandler`, main's dispatch.

These fail `npm run typecheck`:

- An invoke with no handler. `IpcHandlerMap` requires every invoke, and `src/main/handlers/index.ts` returns one.
- A channel declared by two areas, a name used as both an invoke and an event, or a name without an `area:` prefix (`assertIpcAllowListComplete`).

Payloads must be structured-cloneable: plain objects, arrays, strings, numbers, booleans, and null. No functions, class instances, or secrets.

Main's handlers are in `src/main/handlers/<area>.ts`. Each returns `IpcHandlersFor<typeof <area>Channels>`. Email and alerts come from `src/main/email/engine-email.ts`, scheduled reports from `email/reports/ipc.ts`, and exports from `export/ipc.ts`; `handlers/index.ts` composes all of them into `createIpcHandlers`. Request parsers are in `src/main/ipc-request.ts`, `ipc-m2.ts`, `ipc-ai.ts` and `ipc-project-settings.ts`. `handlers/context.ts` holds `IpcHandlerDeps`, the engine context, and `guard`. Every channel in the contract has a handler.

To add a channel:

1. In `src/shared/ipc/<area>.ts`, add the request and response types. Then add one line to the area's spec record: `'area:verb': invokeWith<Request, Result>()` for a call with one argument, or `invoke<Result>()` for a call with none. For a push event, add `'area:event': push<Payload>()` to the area's `…Events` record. That line is the whole contract change.
2. Run `npm run typecheck`. It fails in `src/main/handlers/<area>.ts` until that file returns a handler for the new invoke. Parse the request there (`src/main/ipc-request.ts` or `ipc-m2.ts`), wrap the work in `guard('<channel>', ctx, …)`, and add a test under `src/main/handlers/`. A push event needs no handler. Main sends it with `emit` or `broadcastIpcEvent`.
3. The renderer calls `window.citefox['area:verb'](request)`. Preload, `src/main/ipc.ts`, and `src/shared/ipc/index.ts` do not change.
4. Add the channel to `Docs/IPC.md`.

A new area is a new `src/shared/ipc/<area>.ts` file. Add its records to `INVOKE_GROUPS` (and `EVENT_GROUPS`) and add an `export *` line in `src/shared/ipc/index.ts`. Then add `src/main/handlers/<area>.ts` and spread it in `handlers/index.ts`.

## Renderer security (NFR-16)

Set on the window, and checked by the smoke test:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false` (including workers and subframes)
- `webviewTag: false`
- `webSecurity: true`

Preload refuses to start unless `process.contextIsolated` is true. It exposes `window.citefox` and does not expose `ipcRenderer`.

Remote content does not load in the window. `src/main/navigation.ts` classifies every URL:

- The dev server origin, and `file:` URLs inside the build output, may load.
- Other `http:` and `https:` URLs are external. A user click or `window.open` is denied in the window and opened with `shell.openExternal`. Redirects to those URLs are cancelled and are not sent to the browser.
- Any other scheme (`javascript:`, `data:`, a `file:` outside the app) is cancelled.
- The session request hook cancels anything that is not classed as app content, so a remote script, image, or font cannot load even if markup asks for it.
- The page's Content-Security-Policy is `default-src 'self'` with no remote hosts. `style-src` allows inline styles so the bundled CSS can apply. `connect-src` allows localhost so Vite hot reload can run in development; the session hook still blocks every origin except the dev server, and in a production load there is no dev server, so localhost fetches are cancelled too.

Renderer permission requests (camera, microphone, notifications from the page) are denied. Desktop notifications are raised by the main process, not by a page permission.

There is no IPC channel for opening an arbitrary URL. External links go through the navigation hook.

## Secrets

SRS section 9.2 and NFR-5: secrets live only in the system keychain.

| Layer | Store | Holds |
| --- | --- | --- |
| App | `settings.json` and `app.sqlite` in the app data folder | Connection metadata, not secrets |
| Project | `projects/<slug>.sqlite` | That project's pages, markets, prompts, and settings |
| Secrets | macOS Keychain, Windows Credential Manager, or libsecret | SerpApi, Jina, Anthropic, and YouTube keys; SMTP passwords; Slack webhook URLs |

`app.setName('CiteFox')` runs before the app is ready so the data folder matches the SRS example (`~/Library/Application Support/CiteFox/` on macOS). API keys go to the OS keychain through `src/main/secrets/keychain.ts` (`@napi-rs/keyring`: macOS Keychain, Windows Credential Manager, libsecret on Linux).

- Write the secret only as a keychain item.
- Store `keychain_ref` and a masked hint on `api_keys`. The hint is empty when the secret is 8 characters or fewer, and the last 4 characters otherwise.
- Do not put the secret, or a ciphertext of the secret, in `settings.json`, a project database, a log, or an export.

Electron `safeStorage` encrypts with an OS key, but the ciphertext still has to be stored in a file. That does not meet "never in project files, settings files or exports" (FR-11.11). Use a real keychain item.

SRS section 10 `api_keys` is extended with cached values the engine fills in. There is no user-entered plan column: `cap` is the user's monthly search budget, and the plan name and allowance come from SerpApi's account call.

| Column | Cached value |
| --- | --- |
| `api_keys.state` | Last connection result: `ok`, `warning`, `off`, or `unchecked` |
| `api_keys.last_reason` | Last failed key test or provider call: `rejected`, `out_of_searches`, `rate_limited`, `timeout`, or `other`. Null when `state` is `ok`, `unchecked`, or `off` |
| `serpapi_used` | Searches used, from the SerpApi account call |
| `serpapi_limit` | Plan allowance from that same call |
| `serpapi_plan` | Plan name from that same call |

Claude checkup results are kept in `claude_checkups` (app migration 002). SMTP passwords and Slack webhook URLs use the same keychain store (`email/service/accounts.ts`, `alerts.ts`). Keychain items are named `citefox.<provider>.<keyId>` under the service `CiteFox`; nothing is read at startup, and each secret joins the logger's redaction list the first time it is read or written.

## Providers

All network access is in the main process; the renderer never makes a request. CiteFox contacts only the services the user connects, the pages and sitemaps they ask it to read, and public Reddit thread data for Communities. A Claude Code child never inherits an Anthropic key or OAuth token from the environment.

### Claude Code (`claude-code`)

SRS LLM-3: the claude-code client runs `claude -p` with tools off and the prompt on stdin, in one turn (`--max-turns 1`), except for a call that passes `--json-schema`, which gets `--max-turns 2`. That is a deliberate deviation from LLM-3's single turn: Claude Code returns structured output through a synthetic tool, which needs a follow-up turn, and with one turn about a fifth of first replies ended in `error_max_turns` with prose instead of JSON (live TextBolt run, Oct 21, 2026). The second turn can only deliver that structured reply: every tool restriction below still applies (`--tools ""`, `--disallowedTools mcp__*`, strict empty MCP config, `--safe-mode`, `--restricted`, no session persistence, empty temp cwd), so no tool can run. A schema call that still ends in `error_max_turns` counts as a reply that missed the schema and gets the one schema retry. The transport writes the prompt to a stdin pipe and closes it, so the CLI reads it and starts at once (the earlier stall came from a pipe left open and empty). The prompt is never an argv value, so a long page cannot hit `E2BIG` (about 32K characters on Windows, 128 KB per argument on Linux) and does not show in `ps`. Logs record the argv (which holds no prompt) and the prompt length only. Verified against Claude Code 2.1.305 with a 202,500-character prompt. `--tools ""` and `--disallowedTools mcp__*` are required: a CLI that rejects either is not used, and the call fails with "Update Claude Code to version 2.1.0 or newer". The other restriction flags (`--strict-mcp-config` with `--mcp-config`, `--safe-mode`, `--restricted`, `--no-session-persistence`) are dropped one by one, only when that CLI rejects that flag, and the choice is kept for the process. The child runs with `shell: false` in a fresh empty temp folder (removed afterwards) and leads its own process group, so a timeout or cancel kills it and anything it started. One call waits up to 180 s. A completion starts `claude` at most three times: the first call, one transport retry, and one schema retry, which share one budget. Token usage is summed across those attempts.

### Anthropic API (`anthropic-api`)

`providers/claude/anthropic-api.ts` posts to `https://api.anthropic.com/v1/messages` with the user's key from the keychain: 180 s timeout, two attempts, no retry after a timeout. One process-wide gate (`claude/shared-gate.ts`, 2 calls at once by default) covers both Claude connections. `engine/claude.ts` picks the connection per project (Settings, the Claude Code login, or a named key, plus the project's model) and `engine/claude-fallback.ts` applies its fallback rule (FR-11.7, LLM-10).

### SerpApi

`providers/serpapi/` runs a Google search, then, when the overview needs it, the `google_ai_overview` follow-up with the returned `page_token` on the same key (`engine/checks/capture.ts`). An expired token re-runs the pair once (SERP-3). Keys rotate in one of three modes (in order, spread evenly, project keys) and fail over by cause (`engine/checks/key-rotation.ts`). Plan, used and limit come from the account call.

### Jina Reader and the pinned fetch

`pipeline/page-reader.ts` fetches a page directly first, unless the Jina mode is `always`, and falls back to Jina Reader (`providers/jina/reader.ts`, `https://r.jina.ai/<url>`). Jina keys rotate and fall back to keyless reads (`engine/jina-keys.ts`). Every direct fetch of a user-supplied URL, including sitemaps and robots.txt, goes through `pipeline/fetch-guard.ts`, which resolves every address and blocks private, loopback and link-local ranges (including IPv4-mapped, NAT64 and 6to4 forms), with at most 5 redirects, each checked. `providers/pinned-http.ts` then connects only to the addresses the guard approved (a custom `lookup`, so DNS rebinding cannot swap them), streams with a 5 MB cap and does not follow redirects itself.

### YouTube and Reddit

YouTube Data API calls are read-only, with the user's key (`providers/youtube/`, `communities/youtube-api.ts`). Reddit thread details come from public Reddit JSON at one fixed origin, rate limited (`communities/reddit.ts`). From that same response Check threads keeps a short excerpt (title and top post, at most 600 characters) and the first sentence naming the brand (title, post, then comments; at most 280 characters) in `reddit_threads.excerpt` and `brand_quote` (project migration 026, `communities/excerpt.ts`). CiteFox never posts anywhere.

## Scheduling

| Piece | Where | What it does |
| --- | --- | --- |
| Planner | `scheduler/due.ts` | Works out which page markets and fix follow-ups are due, honouring quiet hours. Missed slots run as catch-up only when both the app's catch-up-after-sleep setting and the project's catch-up are on. A follow-up checks only its fix's prompts |
| Queue | `queue/check-queue.ts`, `runner.ts` | One queue for all projects. It picks the SerpApi key (the runner never sees the secret), counts every search including follow-ups and failovers against live key usage and project caps, and stops before a cap. Pause all lasts until resume; pause today clears at local midnight. Both persist (`pause-store.ts`). One due pass runs at a time for the window, tray and ticks |
| Wake catch-up | `tray/electron-host.ts` | `powerMonitor` `resume` and `unlock-screen` trigger a due pass |
| OS job | `scheduler/os-job/` | Runs the executable with `--check-due` every hour while CiteFox is closed (SCH-1). macOS: a LaunchAgent `app.citefox.checkdue.plist` loaded into `gui/<uid>`. Windows: `schtasks` task `CiteFox\CheckDue`, hourly. Linux: a systemd user service and timer (`Persistent=true`), or a crontab line marked `# citefox-checkdue` when systemd is not available. Output goes to `check-due.log`. Dev builds use an in-memory job unless `CITEFOX_OS_JOB=1`. Settings shows the job's real state |
| Notices | `notices/` | "Ask me" notices with actions, one open notice per dedupe key. `cap-alert.ts` is the single FR-11.4 path for a search cap (desktop, email and a notice offering 10 more searches this month or waiting for the reset). `claude-ask.ts` records a Claude limit or failure that needs a decision |
| Desktop notifications | `tray/electron-host.ts` | Electron `Notification`, raised by main, per the project's alert settings |

## Background page setup and notices

`src/main/setup-runner/` sets up every new page without a stepper (owner feedback 5): a single add (`pages:add`, All pages Track) starts its page at once through `startPage`, skipping the throttle, quiet hours and stagger, and bulk tracking wakes the runner (`withSetupKicks`). The steps are read, buyer profile, buyer prompts (the `pipeline/setup.ts` functions, through `pageSetupDeps`), mark tracked, then content gaps (coverage). No step spends a search: a single add writes a `first_check_waits` row (project migration 033) and the due planner leaves its never-checked markets alone until `checks:start` releases it, unless the project's `check_when_ready` option starts the first check when setup finishes. `setup:page` builds one page's `PagePipeline` (five steps, state, elapsed, the failing step's one action) for the page tabs' setup panel; `setup:start` (Retry, Resume, Start setup, Write content gaps) and `setup:stop` act on one page. Each run is an `assist:progress` run (`setup:run`, scope the page id), so the page read and Claude calls stream into the shared AssistProgress panel. A page that gives up records a `setup_failed` notice whose Retry starts it again. Project migration 024 adds `page_setup_jobs` (one row per page the runner touched: `running`, `retry`, `failed`, `done`, the step, attempts, next try, redacted error) and `project_schedule.cap_over_month`. App migration 021 adds `setup_runner` (pause, pages per hour) and `notices` ("ask me" notices with their actions; one open notice per `dedupe_key`). `createIpcHandlers` builds the runner and hands it to `onSetupRunner`; `index.ts` starts its loop and stops it on quit. `headless/background-pass.ts` runs due sitemap syncs and the runner after the `--check-due` checks. `notices/cap-alert.ts` is the one FR-11.4 `notify` path for the queue's `onCapAlert` and the check engine's `onCapStop`; `notices/claude-ask.ts` records the FR-11.7 `ask` notice from `engine/claude.ts`.

## Templates, AI assists and the Claude call log

Generation templates live in `app.sqlite`, not in a project file. Migration `005_named_templates` rebuilds `templates` forward from the v4 table. `name` was already there. The migration adds `kind` (moved out of `settings_json`), `notes`, `deleted_at`, `is_default`, `is_shipped`, `created_at`, and `updated_at`. Seeded rows `tpl-buyer-profile`, `tpl-buyer-prompts`, and `tpl-coverage` become the shipped `CiteFox default` for that kind, with `is_shipped` and `is_default` set. A later shipped version row, such as `tpl-buyer-profile-v2`, keeps its own name and is not shipped and not the default. A partial unique index allows one live `is_default = 1` row per kind. Every start reseeds the shipped rows: when a release ships a new body, the row with that id gets the new body and hash in place, its `version` goes up by 1, and `updated_at` is set. `is_default` is not touched, so an install whose default is still `CiteFox default` gets the new body, and a user's own default stays the default. A new shipped body needs no migration. Bodies render with `src/shared/template-syntax.ts` (`{{ name }}` and `{# #}` only, nothing evaluated), not Nunjucks.

`templates.schema` and `templates.settings_json` stay on the row. They are not fields on `GenerationTemplate`. `templates:update`, `templates:delete`, and `templates:restore` copy both columns through unchanged. `templates:update` sets `version` to the previous value plus 1, on the same id. Delete and restore leave `version` as it is. A template name is trimmed before the length check. After trim it must be 1–80 characters. A name that is empty or longer than 80 after trim, or that still has leading or trailing whitespace, is rejected with `name_length`.

`templates:list` does not count usage. `templates:usage` counts, on that call, saved buyer profiles, prompt sets, and coverage matrices whose `template_id` is the requested id. It opens each project SQLite file under `projects/`. `projectId` limits the scan to that project. An unknown project counts as zero. `lastUsedAt` is the latest `created_at`, `saved_at`, or `recorded_at` among those rows. Playground runs stay in memory and are not counted. `generations` rows are model attempts and are not counted.

A page keeps every prompt set. Exactly one is active. `prompts:list` returns that set. `prompts:listSets` returns the history, newest first. `prompts:setActive` switches which set is active and does not insert a version. `PageReadResult.snapshotReused` is true when a read reused a stored snapshot because the content hash was unchanged.

Since FR-26 every Claude step is a template kind, including the check steps `aio_gap` and `run_summary`. App migration `020_template_versions_and_llm_calls` rebuilds `templates` without the kind CHECK (kinds are validated in code, so a kind another area adds needs no rebuild), adds `template_versions` (every saved body of an app template), and adds `llm_calls` for Claude calls outside a project. Project migration `022_template_overrides_and_llm_calls` adds `template_overrides` (a project's own versions of a step, TPL-1) and `llm_calls`. `loadGenerationTemplate(appDb, kind, templateId?, channel, projectDb?)` resolves an explicit id, else the project's current version, else the app default; setup and check reports apply the template's settings (`pipeline/template-settings.ts`).

All Claude calls go through providers wrapped by `withCallLog` (`src/main/llm/call-log.ts`), the one logging point for `llm_calls`. Assists share one runner (`src/main/assist/run.ts`), one reply schema and one output-rules preamble; an area adds an assist with `registerAssist`.

Project migration `003_template_names` stores `template_name` on `prompt_sets` and `coverage_runs`, which is the name at generation time. Buyer profiles already had `template_name`. Rows written before that column existed are backfilled with `CiteFox default`.

`ApiKeyMetadata.keychainRef` is the item id. The provider list is `serpapi`, `jina`, `anthropic`, and `youtube`. Claude Code login is not an API key and is not a row in `api_keys` (LLM-2, LLM-9).

The older question filter (`src/main/ask/`) has Claude turn a question into filters, checks them against a schema and the project's ids, then filters stored checks locally (`query.ts`); Ask CiteFox itself is described under Ask CiteFox below. Neither runs a search. Assists (`src/main/assist/`, definitions per screen in `definitions/`) gather saved data, call Claude through the project's connection, validate the reply (one retry) and write nothing; the screen applies a suggestion through its own channels. `llm_calls` rows hold the step, template, model, connection, tokens, duration and outcome, never the prompt or reply, and a failed log write never fails the call.

## Reports, exports and email

One deterministic report model (`export/model/build.ts`, `buildReportModel`, per `Docs/REPORT-SPEC.md`) feeds every output: the interactive HTML report (`export/html/`), PDF (`export/pdf/`, pdfkit with bundled Noto fonts), Excel (`xlsx.ts`, exceljs), CSV tables (`csv.ts`, zipped when there are several) and JSON (`json.ts`, schema `export/schema/citefox-export.v2.json`). Every `{ n, drill }` in the model lists exactly `n` rows, so a report's numbers drill like the app's. Cells that start with a formula character are neutralised. Files are written through a save dialog (the renderer never sends a path) and atomically, via a temp file and rename. Settings → Data → Export all data (`settings:exportAllData`, `export/all-data.ts`) writes one zip through the save dialog: `citefox-data.json` (manifest: app version, time, each project's file or why it is missing), `settings.json` (app settings; secrets live only in the keychain and known values are masked) and `projects/<slug>.citefox.json`, each a whole-project JSON export v2 with every market, every check and the raw section. `settings:openDataFolder` (`export/data-folder.ts`) shows the data folder with `shell.showItemInFolder`. Automatic export (FR-22.6, `export/auto/`): project migration 025 adds `auto_exports` (one row per Export screen scope: on or off, the folder picked in main's native folder dialog, the `ExportSpec`) and `auto_export_runs` (one row per attempt, 50 kept per scope). The window's due pass (`bindScheduleQueueTray`) and `--check-due` note each successful scheduled check in an `AutoExportTracker`; when the pass settles (after the check reports finish), `runAutoExports` writes one new file per touched spec into its folder with the save-dialog filename pattern, never replacing a file (`name (2).ext`), and records the outcome, which the Export screen shows with recent runs. The folder is re-checked (absolute, normalized, an existing writable directory) before every write. Email delivery stays with scheduled reports.

Email (`src/main/email/`) sends through SMTP with nodemailer, or opens a draft in the user's mail app. SMTP refuses a password login without TLS unless the server is on this computer. Presets cover common providers, and Send test reports the server's answer in plain words. Slack-compatible webhooks post alerts. Scheduled reports (`report_schedules`, weekly or monthly, PDF, Excel, CSV, HTML link or summary) are sent by the window or by the headless pass; a missed send stays due, a throttle row stops the same occurrence going twice, and every attempt is a row in `deliveries` (Delivery history).

## Moving to a new Mac (project and settings files)

`src/main/project-transfer/` writes one project to a `.citefox-project.json` file and reads it back; `transfer:*` channels (`src/shared/ipc/transfer.ts`, handlers in `src/main/handlers/transfer.ts`). Main opens the native save and open dialogs, so no path crosses IPC: a picked file stands for an opaque token (`dialogs.ts`, `TokenStore`). Files are written atomically and read up to 200 MB.

- **Export** (`build.ts`): the file carries a format name and version, the project database version and the app version, then the project's rows by section: settings, markets, pages, topics, questions, buyer profile, competitors, products, groups, alert rules, report schedules and notes. Stored check results (runs and their rows) are written only when "Include stored check results" is ticked. Keychain refs and secrets are left out.
- **Import** (`parse.ts`, `stage.ts`, `merge.ts`): the file is checked strictly (format, version, shape) before anything is written; a bad file gets one plain reason. The preview lists the sections and their counts and the projects with the same site. "Import as a new project" creates a project with new ids (`tallies.ts` counts added, skipped and failed rows per section, with a few reasons each); Undo deletes that project through the normal delete. "Replace" merges into the same-site project: its settings take the file's values (this Mac's keys, keychain refs and timers stay), everything else is added unless it is already there (same page address, topic name, market, product, group, alert rule or id), and nothing is removed.
- **App settings** (`settings-transfer.ts`): defaults, Claude choices, the schedule, appearance and how email is sent, as a `.citefox-settings.json` file. API keys, tokens, Slack webhooks and SMTP passwords are keychain items and are never read here; the Claude program path is this Mac's and stays. A file that holds a secret-looking value or an unknown field is refused. The import shows each setting's current and incoming value and reports applied, unchanged or failed per setting.

The renderer side is `src/renderer/src/transfer/`: the Export project, Import project and Import app settings drawers (`drawer=export-project`, `import-project`, `import-settings`), opened from the Projects screen, Settings › Data → Move to a new Mac, and the File menu (main sends `transfer:menu`).

## Importer (questions, pages, competitors)

`src/main/import/` is the one importer behind Add questions, Import pages and the other lists (`import:*` in `src/shared/ipc/importer.ts`). It reads a paste (one per line, TSV from a spreadsheet), CSV, TSV or Excel (`exceljs`) through a token for the picked file, matches columns by header (question, market, stage, page, label, topic), translates stage words, and checks every row as a dry run: new, duplicate (ignoring case and punctuation), near-duplicate, or a fix with its reason. Nothing is saved before `import:commit`, and an import is one batch that `import:undo` removes. A row's market is saved on the row's page or topic (the engine has no per-question market); a Topic column assigns the topic or creates it; a `label` column names new pages. Rows typed or pasted into Add questions and not added yet are kept per project in `question-drafts/<projectId>.json` (`import:getDraft`, `import:saveDraft`, `import:clearDraft`) until they are added or discarded. Nothing is searched by an import. "Match stages and pages by keywords" is word matching, not Claude.

## Ask CiteFox

The assistant opens as an 80% drawer (`drawer=ask`, ⌘J / Ctrl J, the top bar button) over the current screen. Screens describe themselves with `useAiContext` (`src/renderer/src/assistant/context/`): screen id, breadcrumb, entities, ticked rows, filters and the numbers shown. The ✦ menus on KPI tiles, rows and charts open the drawer with a question about that value. Main (`src/main/assistant/`) routes each question to one single-purpose prompt (`intent.ts`), builds a context packet from stored checks for the ids the screen sent, counted in code with refs for every row and number (`packet.ts`), calls Claude, validates the reply shape with one retry (`reply.ts`), drops any sentence whose number is not in the packet (`numbers.ts`), and checks every proposed action card against the packet (`actions.ts`). Action cards (Check now with its cost and searches left, add questions, set a target page, open a drill) run only when the user confirms. With no project open it answers app and setup questions from shipped help (`help.ts`, `app.ts`). It never runs a search. Tests use recorded replies (`src/main/assistant/fixtures`).

## Theme

Light, Dark or System is one setting (`AppSettings.theme`), changed in Settings › Appearance or View › Appearance (`src/main/theme.ts`, `settings:themeChanged`). `nativeTheme.themeSource` is the switch: native menus, dialogs and scroll bars follow, the renderer's `prefers-color-scheme` follows, and the window background is painted first so there is no white flash. Every colour is a token in `src/renderer/src/styles/tokens.css` with a light and a dark value; `tokens.test.ts` fails on a colour literal outside that file or a token with no dark value. The HTML report has its own light default and an in-report toggle.

## Drawers

Edits, drill lists and Ask CiteFox open in `ui/Drawer` (80% wide, 880–1280 px, breadcrumbs, a sticky footer, an unsaved-changes guard, focus returned on close). The open drawers are in the URL (`?drawer=…` plus each drawer's prefixed keys), so Back closes one, Forward reopens it and a copied link opens the same stack; a drawer can open one more over itself. `shell/drawers.ts` opens and closes them and `shell/DrawerHost.tsx` maps each id to its component. See `Docs/DRAWER.md`.

## Site structure, Communities and answer shapes

`src/main/structure/` finds sitemaps (robots.txt, then `/sitemap.xml`), parses them without an XML library, imports pages, and keeps them in sync daily or weekly while the app runs and inside `--check-due` (`sync-loop.ts`). Clusters come from URL rules or from Claude (`cluster-rules.ts`, `claude-prompts.ts`); re-clustering keeps manual edits (`cluster-merge.ts`). Silos, insights and internal-link suggestions are rule-based. `src/main/communities/` classifies each cited URL by source type and builds the Communities tab and the YouTube opportunities flow (`videos/`), including FoxCue sponsor placements. "First seen" (`firstSeenByUrl`) is the first finished check citing a source and the lowest-position prompt in it, so the date opens that answer's Prompt detail pinned to that check. "Draft a helpful reply" (FR-17.6) is the `communities.reply` assist (`assist/definitions/communities.ts`): it reads the cited thread, its excerpt, the buyer prompts citing it and the page, and its reply check requires the answer first (no brand in the first sentence), a disclosure naming the brand, and at most one link, to the project's domain. It refuses archived and locked threads. The draft is copied by the user; nothing is posted. `src/main/analytics/answer-shape/` has Claude split each stored overview into blocks, cached in `answer_shapes`.

## Drill-downs

REPORT-SPEC "Interaction model" and NFR-14: every number, bar, segment and row opens what it counts, and a drawer's total equals the number clicked. The shared pieces live in `src/renderer/src/drill/` (import from `../drill`).

| Piece | Use |
| --- | --- |
| `DrillRequest` | What a drawer lists. `{ kind: 'prompts', rows: PromptCheckRow[] }` or `{ kind: 'items', noun, primaryLabel, columns?, items: DrillItem[], summary? }` (links, claims, pages, domains, checks), plus `id` (the NFR-14 id), `title`, `description` (Markdown), `omitCount?` and `scope` |
| `DrillScope` | `{ pageId, marketId, runId, marketLabel, checkDateLabel, brand, domain }`. Prompt rows open Prompt detail in that market and check. `resultsScope(results, { pageId, market, runId })` builds it from `results:get` |
| `DrillItem` | `{ id, primary, mono?, url?, secondary?, target?, cells?, detail?, group? }`. `url` links the primary text to the browser, `target` is where the row opens, `detail` is Markdown the row expands to, `group` feeds the summary strip |
| `DrillTarget` | `prompt` (page, prompt, market, run, project), `page` (page, tab, market, run, project), `url` (http(s) only) or `hash`. `targetHref`, `openTarget` |
| `<DrillHost>` | Owns the one drawer. `AppShell` wraps every route in one (closed on navigation); a screen that also wraps itself (tests, harnesses) shares the outer one. Props: `exportCsv?` (tests), `resetKey?` |
| `useDrill()` | `{ open(request), close(), current }` from the nearest host |
| `<DrillNumber drill>` | A count that opens its drawer. It shows `drillCount(drill)`, so the total matches by construction, and carries `data-nfr-drill` and `data-nfr-figure`. Optional `label`, `suffix`, `headline` (`data-nfr-headline`) |
| `<DrillButton drill>` | Any other opener (a domain name, a bar segment, a tile). Put a `<DrillFigure drill>` inside when the control shows the count; `untracked` for an opener with no number |
| `<DrillLink target>` | A single item goes straight to its detail, never to a one-row drawer |
| `DrillDrawer` | The drawer: scope line (market · check), summary strip that filters (prompts: Prompts · AIO shown · Page cited · Named · Gap), rows that open on click or Enter, prompt rows that expand to `aioSummary` and sources, "Show all" past 100 rows, and a CSV of exactly the rows shown through `grid:exportCsv` |
| Builders | `resultsDrill(results, id, scope)` for the `drillFor` ids (`funnel:*`, `drop:*`, `bucket:*`, `kpi:*`, `domain:*`, `gap:*`, `overlap:*`, `stage:*`, `ugc`), `specDrill`, `idsDrill`, `whereDrill`, and `ownLinksDrill(results, scope, { part, prompts })` for link-level counts |

Lists: the old `VirtualWindow` (`projects/DataGrid.tsx`) and the standard grid (`grid/`) open a row on Enter or on a click that is not on a control inside it (`components/rowActivation.ts`); links, buttons and fields in a row keep their own keys. `DataGridProps.onActivate` is the row opener; `GridColumn.drill(row)` returns `{ label, onOpen, nfrId? }` (a button) or `{ label, href, external? }` (a link) and wraps that cell.

Routes: `promptHash(pageId, promptId, { marketId, runId })`, `pageHash(pageId, tab, { marketId, runId, filter })`, `pagesHash({ view, folder, cluster, group })`, `structureHash(id?)` and `templatesHash(id?)`. `parseHash` returns them on `ShellLocation` (`marketId`, `runId`, `filter`, `params`, `focusId`) and `locationHash` writes a location back. A pinned market becomes the page's picked market; Results, Citations and Prompt detail load a pinned check.

Page and project-level routes read the open project, so a link to something in another project names its project: `projectHash(projectId, hash)` builds `#/p/<projectId>/<route>` (`src/shared/project-route.ts`, shared with the tray), and a `page` or `prompt` `DrillTarget` with `projectId` does the same. `parseHash` puts the project on `ShellLocation.projectId`; the shell (`shell/useProjectRoute.ts`) switches to that project when it is not the open one, shows "Opening <project>…" meanwhile, then replaces the hash with the plain route (Back skips it). A project that cannot be opened shows why and opens Projects. Cross-project links use it: Check now and Status due lists, running checks and setup rows, Connections and Schedule & alerts project names (`projectSettingsLink`), Ask CiteFox rows, and the tray's Last checks and check notices (main records the switch so a new window starts there, then opens the project route; no reload).

Migrating an older drawer: build a `DrillRequest` and call `useDrill().open` from the opener. `m3/DrillDrawer` (a `DrillSpec` plus rows) and `visibility/CountDrawer` (flat items; pass `noun`) are thin wrappers over the shared drawer for screens that still hold their own state. `AioDrawer`, `ClaimsDrawer` and `CommunityDrawer` map onto `ItemDrill`: one `DrillItem` per answer or claim, `target` to Prompt detail for buyer prompts, `detail` for the overview or claim text, `url` for the source. Sentiment (`sentiment/drills.ts`: claims, overviews, checks) and Communities (`communities/drills.ts`: answers, citations, pages, threads) are migrated; `communities:get` returns every counted citation in `links` and `sentiment:get` returns earlier checks' own claims in `earlierClaims`, so citation counts and every trend point drill.

## Logging

`src/main/logging/` writes to the console and to `<data folder>/logs/citefox.log`, rotated at 5 MB with three files kept (`file-sink.ts`). The window and the headless run share the file. Writes are synchronous; a failed write is dropped, never thrown. `redact.ts` replaces known secret values, `sk-ant-` keys, Bearer tokens, `api_key=` values, JSON `api_key`, `password` and `token` fields, `user:pass@` in URLs, Slack hook URLs and 64-hex SerpApi keys with `[REDACTED]`, and logs prompt text as `[prompt]`. The OS job writes its own `check-due.log`.

## Packaging

`electron-builder.config.ts` (details and signing in `Docs/RELEASING.md`):

- appId `app.citefox.desktop`. macOS DMG and zip (hardened runtime, `build/entitlements.mac.plist`), Windows NSIS per-user installer, Linux AppImage and `.deb` (depends on `libsecret-1-0`).
- `app.asar` with native `.node` files unpacked, `npmRebuild: false`, and an `afterPack` check that fails the build if the better-sqlite3 or keyring binary for the target is missing. Build each architecture on a matching machine.
- Fuses: RunAsNode, `NODE_OPTIONS` and `--inspect` off; cookie encryption, embedded ASAR integrity and only-load-from-ASAR on. GrantFileProtocolExtraPrivileges stays on because the renderer loads from `app.asar` over `file:`.
- Signing is off (`identity: null`) unless `CSC_LINK` or `CSC_NAME` is set; notarization runs when a full set of `APPLE_API_*` or `APPLE_ID` variables is set; Windows signs with `WIN_CSC_LINK`. No auto-update.
- A packaged build ignores `ELECTRON_RENDERER_URL`, has DevTools off, and contains no mock client code.
- `.github/workflows/ci.yml` runs typecheck, lint, format, unit tests, build and e2e on macOS, Windows and Ubuntu. `release.yml` builds installers on one native runner per OS and arch and drafts a GitHub Release on a `v*` tag.
- `build/icon.svg` is a placeholder icon (`npm run icon` renders `build/icon.png`).
