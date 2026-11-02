# Releasing CiteFox

This document covers building, signing, notarizing, and publishing CiteFox installers. The packaging config is `electron-builder.config.ts`. The CI release workflow is `.github/workflows/release.yml`.

## What gets built

Every file is named `CiteFox-<version>-<os>-<arch>.<ext>`. Linux keeps its own arch spelling (`x86_64` for the AppImage, `amd64` for the deb).

| OS      | Files (in `release/`)                                                                                       | Notes                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| macOS   | `CiteFox-<v>-mac-universal.dmg`, `-mac-arm64.dmg`, `-mac-x64.dmg`, `-mac-universal.zip`                     | Universal runs on every Mac; the zip is for an updater   |
| Windows | `CiteFox-<v>-win-x64.exe`, `-win-arm64.exe` (NSIS installers), `-win-x64-portable.exe`, `-win-arm64-portable.exe` | Per-user install, no admin, Start menu + desktop shortcut |
| Linux   | `CiteFox-<v>-linux-x86_64.AppImage`, `-linux-arm64.AppImage`, `CiteFox-<v>-linux-amd64.deb`, `-linux-arm64.deb` |                                                          |

Every build also writes the update files `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml` and `latest-linux-arm64.yml` (`beta*.yml` for a beta), because `publish` names the GitHub provider. Nothing is uploaded by electron-builder: every command passes `--publish never`. The release workflow adds `SHA256SUMS.txt` (`scripts/checksums.mjs`); `npm run dist*` writes one too.

Each build:

- packs `out/` and the production `node_modules` into `app.asar`. Native `.node` files are unpacked to `app.asar.unpacked`.
- skips `@electron/rebuild` (`npmRebuild: false`). better-sqlite3 13 and @napi-rs/keyring ship N-API prebuilds.
- keeps only the target platform's better-sqlite3 prebuild and keyring binary (`mac.files`, `win.files`, `linux.files`). A Mac build keeps both darwin arches, so the x64 and arm64 halves of the universal app hold the same files (`mac.x64ArchFiles` lets @electron/universal keep those single-arch addons as they are).
- flips Electron fuses: RunAsNode, NODE_OPTIONS, and `--inspect` are off; cookie encryption, embedded ASAR integrity validation, and only-load-app-from-ASAR are on. GrantFileProtocolExtraPrivileges stays **on**, because the renderer is loaded with `loadFile` from inside `app.asar`, and Electron 44 cannot read `app.asar` through `file:` with that fuse off. Turning it off would mean serving the renderer from a custom `app://` protocol.
- fails in `afterPack` when the better-sqlite3 prebuild or the `@napi-rs/keyring-<platform>-<arch>` binary for the target is missing.

**Building another arch.** npm installs only the host's `@napi-rs/keyring-*` binary. To package another arch on the same machine, add that arch's binary first: `node scripts/add-native-arch.mjs darwin x64` (or `win32 arm64`, `linux arm64`). It downloads the exact tarball `package-lock.json` names and checks its sha512. The release workflow does this, so one runner per OS builds every arch. Without it, the `afterPack` check stops the build.

## Versioning

CiteFox follows semantic versioning. `package.json` `version` is the app version: it appears in the app, the installer names, the footer's release line, and the macOS bundle version. The build number on the release line is the git commit count (`scripts/build-number.ts`), so it only goes up; the release workflow checks out the full history for it.

| Change                                  | Command                          | Example                   |
| --------------------------------------- | -------------------------------- | ------------------------- |
| Fixes only                              | `npm run release -- patch`       | 0.13.0 → 0.13.1           |
| New features                            | `npm run release -- minor`       | 0.13.1 → 0.14.0           |
| Breaking change (data, settings, files) | `npm run release -- major`       | 0.14.0 → 1.0.0            |
| A beta of the next minor                | `npm run release -- minor --beta` | 0.14.0 → 0.15.0-beta.1    |
| The next beta of it                     | `npm run release -- minor --beta` | 0.15.0-beta.1 → 0.15.0-beta.2 |
| Release that beta as stable             | `npm run release -- minor`       | 0.15.0-beta.2 → 0.15.0    |

Add `--dry-run` to see the next version and the changelog section without changing anything.

`npm run release` (`scripts/release.ts`):

1. refuses a dirty working tree or a tag that already exists;
2. runs `npm run typecheck`, `lint`, `build` and `test:unit` (nothing changes when one fails);
3. bumps `package.json` and `package-lock.json`;
4. writes `## <version> — <date>` (Toronto date) in `CHANGELOG.md`: the hand-written `## Unreleased` notes, then the conventional commits since the last tag grouped as Important (breaking), New (`feat`), Fixed (`fix`), Faster (`perf`) and Other changes (commits without a type). `chore`, `ci`, `docs`, `test`, `refactor`, `build` and `style` stay out. With no earlier tag, only the Unreleased notes are used;
5. commits `chore(release): v<version>` and creates the annotated tag `v<version>`;
6. **does not push.** It prints `git push origin <branch> v<version>`. Read the changelog section, fix it with `git commit --amend` and `git tag -f -a v<version>` if needed, then push.

Commit message conventions are in `CONTRIBUTING.md`.

A database migration is one-way. An older CiteFox refuses data written by a newer one and tells the user to update. Note new migrations in the changelog.

## Local builds

```bash
npm ci
npm run dist        # current OS and arch
npm run dist:mac    # or dist:win / dist:linux
npm run pack        # unpacked app only, no installer
```

Without signing credentials the build is unsigned. On macOS it is ad-hoc signed (`identity: '-'`, hardened runtime off), so a Developer ID certificate in your keychain is not picked up by accident, and the sealed bundle makes macOS offer **Open Anyway** rather than calling the app damaged.

`npm run dist*` finishes by running `scripts/clean-release.mjs`, which leaves only this version's downloads and the `latest*.yml` files in `release/` (older versions, the unpacked app, blockmaps and debug files are removed), then `scripts/checksums.mjs`, which writes `SHA256SUMS.txt`. The CI workflow calls electron-builder directly and keeps everything it uploads.

Linux packages build on any Linux; the `.deb` step runs electron-builder's bundled `fpm`, whose Ruby needs `libcrypt.so.1` (Arch: the `libxcrypt-compat` package; Ubuntu has it). macOS packages need a Mac (`lipo`, `codesign`, `hdiutil`); Windows installers need Windows or Wine.

Check a build (run `npm run pack` first so `release/mac-arm64/CiteFox.app` exists):

```bash
npx @electron/fuses read --app release/mac-arm64/CiteFox.app
CITEFOX_PACKAGED_APP=release/mac-arm64/CiteFox.app/Contents/MacOS/CiteFox \
  npx playwright test tests/e2e/packaged.spec.ts
```

The build's short git commit and build time are compiled into the main bundle (`__CITEFOX_BUILD__` in `electron.vite.config.ts`) and shown next to the version in the header. A build made outside git shows no commit. Before you install a new test build over an old one, use **Reset CiteFox, keep my keys** in the old build (or open **Test as a new user**) to test the first run. The README's "Testing installed builds" section has the details.

The packaged smoke test starts the binary with a temporary `--user-data-dir`. It checks that onboarding renders from `app.asar`, that the SQLite database is created, and that the log has no errors. The inspect fuse is off, so it drives the window over the Chromium DevTools port rather than through Playwright's `_electron.launch`.

## macOS signing and notarization

You need an Apple Developer Program membership and a **Developer ID Application** certificate.

| Variable                                                    | Purpose                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `CSC_LINK`                                                  | Base64 `.p12` (or a path/URL) of the Developer ID Application certificate |
| `CSC_KEY_PASSWORD`                                          | Password for that `.p12`                                         |
| `CSC_NAME`                                                  | Alternative to `CSC_LINK`: name of a certificate already in the keychain |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`     | Notarization with an App Store Connect API key. `APPLE_API_KEY` is the path to the `.p8` file (preferred) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`  | Notarization with an Apple ID and an app-specific password       |

Signing turns on when `CSC_LINK` or `CSC_NAME` is set. Notarization turns on when one full set of `APPLE_*` variables is set. electron-builder then submits the app to Apple and staples the ticket. The app uses the hardened runtime with `build/entitlements.mac.plist`, which grants only `com.apple.security.cs.allow-jit` (V8). Native addons are re-signed with the app's identity, so library validation does not need to be disabled.

Verify a signed build:

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/CiteFox.app
spctl --assess --type execute --verbose release/mac-arm64/CiteFox.app
xcrun stapler validate release/CiteFox-<v>-arm64.dmg
```

Keep the same Developer ID across releases. Keychain items that CiteFox creates trust the app's designated requirement. A build signed by another team (or an unsigned one) makes macOS ask for the keychain password the first time it reads an existing key.

## Windows signing

| Variable                                  | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `WIN_CSC_LINK` (or `CSC_LINK`)            | Base64 `.pfx` (or a path/URL) of the code-signing certificate |
| `WIN_CSC_KEY_PASSWORD` (or `CSC_KEY_PASSWORD`) | Password for that `.pfx`                            |

Without them the installer is unsigned and SmartScreen warns users. New OV certificates build SmartScreen reputation slowly. An EV certificate, or a cloud signing service such as Azure Trusted Signing (configured through `win.azureSignOptions`), avoids most of that. Certificates kept on hardware tokens need `win.signtoolOptions` with a custom sign step instead of `WIN_CSC_LINK`.

The installer is per-user by default (`perMachine: false`) and lets the user choose the install folder. Uninstalling keeps the CiteFox data folder.

## Linux

No signing is needed. The AppImage uses the static type2 runtime (`toolsets.appimage` in `electron-builder.config.ts`), so it does not need libfuse2. The `.deb` lists Electron's runtime libraries and `libsecret-1-0` as dependencies, so apt installs them. Keys are stored through the Secret Service, so users need GNOME Keyring, KWallet, or another Secret Service provider running. The `deb` maintainer is `hello@welco.ai` and `extraMetadata.homepage` (required by the `.deb` build) is the GitHub repository. Change them if the project gets its own domain.

## Opening unsigned builds

CiteFox has no paid code signing yet. The Mac app is ad-hoc signed and not notarized; the Windows installer is unsigned. Users see one warning before the first start. The download page (`site/`) and every release's notes say this too.

**macOS 15 Sequoia and later**

1. Open the `.dmg` and drag CiteFox to Applications.
2. Open CiteFox. macOS says it cannot check the app for malicious software. Click **Done**.
3. Open **System Settings › Privacy & Security**, scroll to Security and click **Open Anyway** next to "CiteFox was blocked". Confirm with the password or Touch ID.

**macOS 14 and older:** right-click (or Control-click) CiteFox in Applications and choose **Open**, then **Open** again.

If macOS ever says the app "is damaged and can't be opened" (a download tool that changed the file can cause it), run `xattr -dr com.apple.quarantine /Applications/CiteFox.app` in Terminal once.

An ad-hoc signature changes with every build, so after an update macOS may ask once whether CiteFox may read the keys it saved in the Keychain. **Always Allow** answers it. A Developer ID certificate ends this (see the macOS signing section).

**Windows:** when SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. The installer installs for the current user under `%LOCALAPPDATA%\Programs\CiteFox` with no admin prompt, and adds Start menu and desktop shortcuts. The portable `.exe` runs without installing. SmartScreen warns less once a file has been downloaded often, and stops with a signed installer.

**Linux:** nothing to approve. Make the AppImage executable (`chmod +x`), or install the deb with `sudo apt install ./CiteFox-<v>-linux-amd64.deb`.

Anyone can check a download: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` (Mac, Linux) or `Get-FileHash .\CiteFox-<v>-win-x64.exe` (Windows PowerShell), compared with the line in `SHA256SUMS.txt`.

## CI release workflow

`.github/workflows/release.yml` runs on a `v*` tag push (or a manual dispatch, which only builds):

| Job           | Runner           | Builds                                                                                           |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| verify        | `ubuntu-latest`  | Fails when the tag is not `v` + `package.json` version, or `CHANGELOG.md` has no section for it |
| macos         | `macos-latest`   | `--mac`: universal, arm64 and x64 dmg, universal zip (adds the darwin-x64 keyring binary first) |
| windows       | `windows-latest` | `--win --arm64`, then `--win --x64`: NSIS installer + portable each (adds win32-arm64 first)    |
| linux         | `ubuntu-latest`  | `--linux --x64 --arm64`: AppImage + deb each (adds linux-arm64 first)                           |
| draft-release | `ubuntu-latest`  | Merges the files, writes `SHA256SUMS.txt`, creates the **draft** release                        |

The draft release gets every installer, the blockmaps, the `latest*.yml` files and `SHA256SUMS.txt`. Its notes are `node scripts/release.ts notes v<version>`: the CHANGELOG section, then which file to pick and how to open an unsigned build. A tag with a hyphen (`v0.15.0-beta.1`) is marked as a **prerelease**, so GitHub's "latest release" (and the download page) keeps showing the last stable version. Re-running the job updates the same draft. Publishing the draft is a click on GitHub.

Windows builds both arches on one runner in two runs, because one run with both arches would make a single two-arch installer. `latest.yml` therefore describes the x64 installer (written last); Windows on Arm users update from the download page until auto-update is wired.

Repository secrets (all optional; missing ones give unsigned builds):

| Secret                                                     | Becomes                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`                     | `CSC_LINK`, `CSC_KEY_PASSWORD` on macOS jobs        |
| `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | API-key notarization. The `.p8` contents are written to a temp file |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Apple ID notarization                               |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Windows signing                                     |

## Download page

`site/` is the download page: plain HTML, CSS and JavaScript, no build step, in the app's sepia palette with the fox mark from `build/icon.svg` (copied to `site/icon.svg`; copy it again when the icon changes). In the browser it reads `GET /repos/<owner>/<repo>/releases/latest` from the GitHub API (stable releases only), then:

- shows one big button for the visitor's computer: the Mac chip comes from User-Agent Client Hints or the WebGL renderer; when it stays unknown (Safari), both Mac buttons and a link to the universal file are shown; Windows gets the installer, Linux the AppImage, a phone a note to open the page on a computer;
- lists every download with its size and SHA-256 (from the API's asset digest, or `SHA256SUMS.txt`), each with a copy icon;
- shows how to open an unsigned app, the release notes, a link to older versions and betas, and "Source-available · © Space-O Technologies" linked to `LICENSE`.

The repo comes from the address (`<owner>.github.io/<repo>/`), else from `<meta name="citefox-repo">` in `site/index.html`. `.github/workflows/pages.yml` deploys `site/` on every push to `main` that changes it (or by hand). A new release needs no redeploy. Logic is in `site/release.js` and tested in `src/main/download-site.test.ts`.

Preview locally: `npx serve site` (or any static server), then open the printed address. The GitHub API allows 60 unauthenticated requests per hour per visitor IP.

## Refresh screenshots and demo video

The README and the download page use the files in `media/` (lowercase, at the repo root, not `Docs/`): `hero.png`, `summary.png`, `question.png`, `reports-home.png`, `report-visibility.png`, `competitors.png`, `fixes.png`, `demo.mp4` and `demo.gif`. The site build copies them into `site/media` itself.

Re-record them after a UI change:

```sh
npm run media:record                 # about 2 minutes; needs Docker
npm run media:record -- --rebuild    # rebuild the e2e image first
```

`scripts/media/record-demo.mjs` runs `tests/media/demo.spec.ts` inside the e2e Docker image (`docker/e2e.Dockerfile`), so no window opens on your screen. The spec seeds the TextBolt demo project (`tests/e2e/reports-seed.ts` plus the TextBolt topic; no keys, no live calls), opens the app at 1440×900 in Sepia with the guide and tips off, takes 2× screenshots, then records a screencast tour: Summary, a topic, a question, Competitors, Fixes, Reports › By goal, the Visibility report with a drill drawer, and back to Reports, with four short captions. The script then writes the PNGs at 2400 px wide, `demo.mp4` (H.264, about 50 s, under 10 MB) and `demo.gif` (the Reports drill, 960 px, under 8 MB) into `media/`, using ffmpeg and ImageMagick on your computer when both are installed and inside the container otherwise. It removes its container; the image and cache volumes stay, as with `npm run test:e2e:docker`.

The spec is not part of the e2e suite (it lives in `tests/media/`, with its own Playwright config) and skips itself outside Docker. To change the tour or a shot, edit `tests/media/demo.spec.ts`. Look at every file before you commit it: no drawers half open, no spinners, no provider names, no real keys or personal names. `npm run media:record -- --process <folder>` re-encodes an earlier raw run.

## First release checklist

1. The repo `spcaeo/citefox` must be **public**: the download page calls the GitHub API without a token, and visitors download release files without signing in. (A private repo still gets draft releases, but the page shows "See releases on GitHub" and downloads need access.)
2. **Settings › Actions › General:** Actions allowed. No extra token is needed; the release job asks for `contents: write` itself.
3. **Settings › Pages › Build and deployment › Source: GitHub Actions.** Then push `site/` to `main` (or run the "Download page" workflow by hand). The page is at `https://spcaeo.github.io/citefox/`.
4. Tidy `## Unreleased` in `CHANGELOG.md` into short, user-facing lines.
5. On a clean `main`: `npm run release -- minor --dry-run`, then `npm run release -- minor`.
6. Run the push command it prints (`git push <remote> main v<version>`; the remote is the branch's upstream, else the GitHub remote, here `github`). Watch the Release workflow.
7. Open the draft on GitHub › Releases, download one file per OS and try it, then **Publish release**.

## Updates (download only)

CiteFox tells people about a new version and helps them download it; it does not install
updates by itself. Decision (2026-11-02): **download only, on every OS, Windows included.**
electron-updater on an unsigned NSIS build would work technically, but it needs a `publish`
config and update feed in every release, SmartScreen still warns on each install, and a broken
update is far harder to support than a download link. Revisit when builds are signed.

How it works (`src/main/updates/service.ts`, `src/shared/release-compare.ts`):

- A packaged app reads `https://api.github.com/repos/<repo>/releases/latest` at most every
  12 hours (the repo comes from package.json `repository`, today `spcaeo/citefox`).
  **Check for updates** in the ⚙ menu reads it at once. Development and test runs never check
  on their own.
- It compares the release tag's version with package.json's, then the build number. The
  release names its build as `build 1500` in its title or notes, or as a tag suffix
  `v0.13.0+1500`; without one, only the version counts. Drafts and pre-releases are ignored
  (GitHub's `latest` skips them).
- A newer release shows a banner over every screen: "CiteFox vX is out · What's new ·
  Download", plus a dot and "vX available" on the footer release line. Download opens the
  installer for this computer: the Mac `universal` .dmg first (else the one for its arch),
  the Windows `.exe`, or the Linux AppImage for its arch; otherwise the release page. Closing
  the banner lasts until the next release.

To ship an update: bump `version` in package.json, tag `vX.Y.Z`, let the workflow build the
draft, add the notes (and "build N" from the footer if you rebuild the same version), and
**publish** the release. Installed apps see it within 12 hours.

## Registration (Join CiteFox)

The official Apps Script web app URL (the owner's Sheet on getcitifox@gmail.com, set up
2026-11-02) is built in (`OFFICIAL_REGISTER_URL` in `electron.vite.config.ts`); set
`CITEFOX_REGISTER_URL` only to point a build elsewhere. Only an **installed** app joins and
pings: dev runs, `npm run build` used by e2e, and tests never call out, unless
`CITEFOX_REGISTER_DEV=1` is set to try the Join step against the real Sheet. If the script is
redeployed, use Manage deployments › edit › New version, so the URL stays the same. What is
sent: `Docs/PRIVACY.md`.

## Placeholders to replace before a public release

- `build/icon.svg` / `build/icon.png`: the app icon is a placeholder. Re-render with `npm run icon` after editing the SVG. electron-builder generates `.icns` and `.ico` from the PNG.
- The `deb` maintainer address and the `extraMetadata.homepage` URL (required by the `.deb` build) in `electron-builder.config.ts`.
- `publish.owner` / `publish.repo` in `electron-builder.config.ts`, `<meta name="citefox-repo">` in `site/index.html` and the `homepage` metadata, if the repo is not `spcaeo/citefox`.
