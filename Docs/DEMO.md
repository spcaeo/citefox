# Live demo and sample reports

The public site has two things visitors can try without installing CiteFox:

| Page | URL | Made by |
|---|---|---|
| Live demo | `/citefox/demo/` | `npm run demo:build` → `site/demo/` |
| Sample reports | `/citefox/samples/` and `/citefox/samples/<slug>/` | `npm run samples:build` → `site/samples/<slug>/index.html`; the gallery by `scripts/site/build-site.mjs` |

Both use the **TextBolt demo project**: the e2e reports seed (`tests/e2e/reports-seed.ts`:
4 pages, 44 questions, 3 checks, 3 engines, fixes, 2 markets) plus the TextBolt topic
(`src/main/topics/fixture-seed.ts`), the same project as the marketing media. No keys, no
network, no AI (`tests/demo/project.ts`).

## How the live demo works

The demo is the real renderer (`src/renderer/src`) built for the browser by
`vite.demo.config.ts`, with `src/renderer/demo/main.tsx` as the entry. Instead of the
Electron preload, `window.citefox` is the **demo bridge** (`src/renderer/demo/bridge.ts`),
built with the same `createCiteFoxApi` as the preload, so every channel in the IPC contract
exists. Each invoke follows `src/renderer/demo/policy.ts`:

- **read** (`DEMO_READS`): answered from `src/renderer/demo/snapshot.json`, the recorded
  answers of the real handlers on the demo project. The exact arguments win; otherwise the
  closest recorded call (same ids first), so a report asked for in another time zone still
  answers.
- **quiet** (`DEMO_QUIET`): small changes the screens make (the guide's progress, a column
  layout, the theme). Answered in memory for this tab; nothing is saved.
- **blocked**: everything else (Check now, keys, email, downloads, AI calls, any saved
  change). The call rejects with *"This is a demo with sample data. Download CiteFox to run
  real checks."* and, when the person just clicked or typed, the page shows that message
  with a Download link (and a link to the sample reports for a report download). A call a
  screen makes on its own stays quiet.
- Fixed answers: `account:get` is off (no Join step), `updates:*` say no update (no update
  banner), `app:getInfo` is the demo's release (version from package.json, build number and
  time stamped by the build).
- Push events never fire. Only the app's own `localStorage` keys (theme, remembered views)
  persist.

The page adds a slim banner ("Live demo · sample data · Download the free app"), its own
search metadata and a `<noscript>` fallback with screenshots (`src/renderer/demo/index.html`).
Routing is by hash, and the base is relative, so it works under `/citefox/demo/`.

The snapshot ships as its own file (`assets/snapshot-*.json`, fetched once), so the app's
JavaScript stays the same size as the desktop renderer's.

### Recording the snapshot

```
npm run demo:record
```

Runs inside the e2e Docker image only (`scripts/demo/docker.mjs`, no window on your screen):
seeds the demo project, builds the demo with `VITE_CITEFOX_DEMO_RECORD=1` (its bridge sends
each read to the real handlers over a local server), walks every screen
(`tests/demo/crawl.ts`: the main screens on every engine, every question, page tab, topic
view, report and some drill drawers, help, the Guide and Ctrl+K), cleans the answers
(`tests/demo/scrub.ts`: no folder paths, key hints, emails or provider names in shown text)
and writes `src/renderer/demo/snapshot.json`. Commit the new snapshot.

Re-record after a change to a read handler's result or to what a screen asks for.
`src/renderer/demo/bridge.test.ts` fails when a read in the policy has no recorded answer,
when a new channel is not classified, or when the data is not clean.

## Sample reports

`tests/demo/samples.e2e.ts` (run by vitest, Node only) builds one report per ready report
kind with the app's offline HTML download (`buildReviewDownload` + `reviewHtml` in
`src/main/export/review`, the same code as Download › Offline HTML), checks it with the
download's own quality check, and adds search metadata and a small "Sample report made with
CiteFox · Download" pill (`tests/demo/sample-page.ts`; fixed in a corner, styled by an inline
`<style>` the report's CSP allows, hidden when printing). The list, with each report's goal
and description, is `scripts/site/samples.mjs`; the site build makes the gallery and adds
every page to `sitemap.xml`.

## Build order

```
npm run site:build    # = demo:build, then samples:build, then the site pages
```

The Pages workflow (`.github/workflows/pages.yml`) runs `npm ci` (without the Electron
binary) and `npm run site:build`. `site/demo/` and `site/samples/*/` are build output
(git-ignored); `site/samples/index.html` is a site page like the others.

## Checking

```
npm run demo:check                 # Docker only
npm run demo:check -- --shots <dir>
```

Builds the demo, the samples and the site in the container, serves `site/` like GitHub
Pages, opens each main screen (heading, real content, no error text, no provider name),
opens a report and a drill, clicks Check now (the demo notice must show), opens help and
Ctrl+K, walks the whole tour (no console errors, no crash), opens each sample report and
the gallery, and saves screenshots (default `test-results/demo-shots/`).
