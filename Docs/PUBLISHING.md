# Publishing CiteFox

CiteFox is developed in a **private** repo and published to a **public** repo that starts from a clean snapshot.
No private history goes public: each sync adds one ordinary commit to the public repo, so public history grows
normally from the first snapshot.

```
private repo (all work, full history)
   │  npm run public:sync          export + checks + one commit
   ▼
.public-export/  (its own git repo, git-ignored in the private repo)
   │  you review, then push yourself
   ▼
github.com/spcaeo/citefox  (public)
```

## Daily flow

1. **Work privately** as usual: branches, commits, merges. The pre-commit hook blocks a commit that adds a key.
2. **Preview** what would change in the public repo:
   ```sh
   npm run public:sync -- --dry-run        # first 200 paths per list
   npm run public:sync -- --dry-run --all  # every path
   ```
3. **Sync** the commit you want to publish (default `HEAD`; must be committed, the working tree is not read):
   ```sh
   npm run public:sync
   npm run public:sync -- --ref desktop/live
   ```
   The script exports `git ls-files` at that commit, filtered by `public-sync.config.json`, into `.public-export/`,
   runs the checks below and commits there as
   `Sync from private <short sha>: <commit subjects>`, with a `Private-Commit:` trailer the next sync starts from.
4. **Review** the public commit:
   ```sh
   git -C .public-export show --stat HEAD
   git -C .public-export commit --amend    # edit the message if needed
   ```
5. **Push** it yourself. The script prints the command and never runs it:
   ```sh
   git -C .public-export remote add origin git@github.com:spcaeo/citefox.git   # first time only
   git -C .public-export push -u origin main
   ```

Contributions made on the public repo come back by hand: apply the PR's patch in the private repo
(`gh pr diff <n> | git apply`), commit with the contributor as author, and the next sync carries it out again.

## What is published

`public-sync.config.json` (private, never exported) decides:

- **include** is an allow-list: `src/`, `tests/`, `resources/`, `build/`, `docker/`, `examples/`, `scripts/`, `site/`,
  `server/`, `.github/`, `Docs/`, `docs/` (README screenshots in `docs/media/`), and the root files the build needs
  (package files, configs, LICENSE, NOTICE, TRADEMARKS.md, README, CONTRIBUTING, SECURITY, SUPPORT,
  CODE_OF_CONDUCT, CITATION.cff, SPONSORS, CHANGELOG). A new top-level folder is not published
  until you add it; a dry run lists it under "Not in the include list".
- **exclude** drops private paths: `.claude/`, `CLAUDE.md`, memory folders, `.env*` (except `.env.example`), key files,
  databases, `Docs/reference-reports/`, `Docs/prompt-eval/`, `eval/`, this repo's audit, and the internal planning
  docs marked `PROPOSED` (delete an entry to publish that file). The last matching exclude wins; `!glob` puts a
  path back.
- **privateSubjectWords**: a commit subject containing one of these words is published as "Private change".
- **commitAuthor**: optional `Name <email>` for public commits; empty uses your git identity.

Globs match the whole path: `**` crosses folders, `*` does not.

## Checks before every public commit

A failed check stops the sync; nothing is committed (fix it in the private repo, commit, run again).

- **gitleaks** on the exported files with `.gitleaks.toml`, plus the built-in pattern scan. gitleaks is required
  (Arch `pacman -S gitleaks`, Mac `brew install gitleaks`, or `GITLEAKS_BIN=/path/to/gitleaks`); `--builtin-scan`
  runs with the built-in scan alone.
- **Licence:** `LICENSE`, `NOTICE` and `TRADEMARKS.md` exist, `package.json` says `SEE LICENSE IN LICENSE`, and no file
  calls CiteFox Apache-2.0 (third-party mentions are allowed by path in `apacheAllowed`).
- The target folder must be inside the project and git-ignored.

## Guard rails in daily work

- **Pre-commit hook** (`scripts/hooks/pre-commit`), switched on by `npm install` (`prepare` sets
  `core.hooksPath=scripts/hooks`; skipped in CI or with `CITEFOX_SKIP_HOOKS=1`). It runs
  `gitleaks protect --staged` when gitleaks is installed, otherwise a built-in scan of the staged lines for
  `sk-…`, `AIza…`, `ghp_…`, `xox…`, private key blocks and high-entropy values assigned to `*KEY*`, `*TOKEN*`,
  `*SECRET*`, `*PASSWORD*`. A plainly fake test value passes; a line can opt out with `// gitleaks:allow`;
  `git commit --no-verify` skips once. Run it by hand with `npm run secrets:scan`.
- **CI** (`.github/workflows/ci.yml`, job "Secret scan") runs gitleaks over the full history on every push and PR,
  in both repos.
- **`.gitignore`** covers `.env*`, key files (`*.p8`, `*.p12`, `*.pfx`, `*.pem`, `*.key`), databases, `release/`,
  `.public-export/`, `Docs/reference-reports/` and `/eval/`.

## Keys

- User keys live in the OS keychain (`src/main/secrets/`); the database keeps only a masked hint.
- Developer keys for `smoke:live` go in `.secrets/.env`, a git-ignored folder inside the project (`.env.example` lists the names).
- Never put a key in code, a test or a doc. If one is ever committed, **rotate it**, even after it is removed:
  private history keeps it.

## Files

- `scripts/public-sync.mjs`: the sync. `scripts/lib/public-sync-core.mjs`: filters, plan, message and licence check
  (tests: `scripts/lib/public-sync-core.test.mjs`).
- `scripts/lib/secret-scan.mjs`: built-in scan. `scripts/hooks/`: the hook and its installer.
- `.gitleaks.toml`: gitleaks rules and the narrow allow-list of fake test values.

## The public site

`site/` is the GitHub Pages site: the download page, the docs (one page per `Docs/help/*.md` topic under
`site/docs/<topic>/`), the GEO and AEO glossary, `sitemap.xml`, `robots.txt` and a 404 page.

- `npm run site:build` rebuilds the pages from `Docs/help/` and `scripts/site/content.mjs` (the landing copy, FAQ and
  glossary), and copies the screenshots in `docs/media/` to `site/media/` (not committed). Commit the rebuilt pages.
  The deploy workflow (`.github/workflows/pages.yml`) runs the same build before it uploads.
- `npm run site:og` redraws the share images `site/og.png` (1200 × 630) and `.github/social-preview.png`
  (1280 × 640) with `rsvg-convert`.
- The site address is `SITE_URL` in `scripts/site/config.mjs`; change it there for a custom domain.
- `scripts/site/build-site.test.mjs` checks every page: a unique title and description, one H1, a canonical, share
  tags, alt texts, JSON-LD that parses, headings in order, links that resolve, no provider names, and that `site/`
  matches a fresh build. A new help topic must be added to `DOC_GROUPS` in `scripts/site/content.mjs`.
- `.github/REPO-SETTINGS.md` has the repository description, topics and `gh repo edit` commands.
