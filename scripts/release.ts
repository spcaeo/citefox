import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `npm run release -- patch|minor|major [--beta] [--dry-run]` (Docs/RELEASING.md).
 *
 * Checks the tree is clean and the checks pass, bumps the version in
 * package.json and package-lock.json, writes the CHANGELOG section (the
 * hand-written `## Unreleased` notes plus the conventional commits since the
 * last tag), commits, and tags `v<version>`. It never pushes: it prints the
 * push command instead. The tag push starts .github/workflows/release.yml.
 *
 * `node scripts/release.ts notes v1.2.0` prints that version's release notes
 * (the workflow uses it for the GitHub Release body).
 *
 * Runs on Node's built-in type stripping, so only erasable TypeScript here.
 */

export type BumpKind = 'patch' | 'minor' | 'major'

export interface Version {
  major: number
  minor: number
  patch: number
  /** `beta.2` → ['beta', 2]; empty for a stable release. */
  pre: [string, number] | null
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/

export function parseVersion(text: string): Version {
  const match = VERSION_RE.exec(text.trim().replace(/^v/, ''))
  if (!match) throw new Error(`Not a version CiteFox can bump: "${text}"`)
  const [, major, minor, patch, preId, preNum] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: preId ? [preId, Number(preNum)] : null
  }
}

export function formatVersion(v: Version): string {
  const base = `${v.major}.${v.minor}.${v.patch}`
  return v.pre ? `${base}-${v.pre[0]}.${v.pre[1]}` : base
}

const RANK: Record<BumpKind, number> = { patch: 0, minor: 1, major: 2 }

/** Which bump a base version stands for: 2.0.0 is a major, 1.3.0 a minor, 1.2.4 a patch. */
function levelOf(v: Version): BumpKind {
  if (v.minor === 0 && v.patch === 0) return 'major'
  if (v.patch === 0) return 'minor'
  return 'patch'
}

function bumpBase(v: Version, kind: BumpKind): Version {
  if (kind === 'major') return { major: v.major + 1, minor: 0, patch: 0, pre: null }
  if (kind === 'minor') return { major: v.major, minor: v.minor + 1, patch: 0, pre: null }
  return { major: v.major, minor: v.minor, patch: v.patch + 1, pre: null }
}

/**
 * The next version.
 * - 1.2.3 patch → 1.2.4, minor → 1.3.0, major → 2.0.0
 * - 1.2.3 minor --beta → 1.3.0-beta.1; again → 1.3.0-beta.2
 * - 1.3.0-beta.2 minor (or patch) → 1.3.0: the beta graduates
 * - 1.3.0-beta.2 major → 2.0.0 (a bigger bump than the beta's starts a new line)
 */
export function nextVersion(current: string, kind: BumpKind, beta = false): string {
  const v = parseVersion(current)
  const base: Version = { ...v, pre: null }
  // A prerelease already reserves its base version; a bump no bigger than it
  // stays on that base.
  const keepBase = v.pre !== null && RANK[kind] <= RANK[levelOf(base)]
  const target = keepBase ? base : bumpBase(base, kind)
  if (!beta) return formatVersion(target)
  const sameLine = keepBase && v.pre?.[0] === 'beta'
  return formatVersion({ ...target, pre: ['beta', sameLine && v.pre ? v.pre[1] + 1 : 1] })
}

export interface Commit {
  subject: string
  body: string
}

export interface ParsedCommit {
  type: string
  scope: string | null
  breaking: boolean
  subject: string
}

const CONVENTIONAL_RE = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i

/** `feat(reports)!: add X` → { type: 'feat', scope: 'reports', breaking: true, subject: 'add X' }. */
export function parseCommit(commit: Commit): ParsedCommit {
  const match = CONVENTIONAL_RE.exec(commit.subject.trim())
  const breakingNote = /^BREAKING[ -]CHANGE:/m.test(commit.body)
  if (!match) {
    return { type: 'other', scope: null, breaking: breakingNote, subject: commit.subject.trim() }
  }
  const [, type, scope, bang, subject] = match
  return {
    type: (type ?? '').toLowerCase(),
    scope: scope ?? null,
    breaking: Boolean(bang) || breakingNote,
    subject: (subject ?? '').trim()
  }
}

/** The user-facing groups, in order. Types not listed (chore, ci, docs, test…) stay out. */
const GROUPS: { title: string; types: string[] }[] = [
  { title: 'New', types: ['feat'] },
  { title: 'Fixed', types: ['fix'] },
  { title: 'Faster', types: ['perf'] },
  { title: 'Other changes', types: ['other'] }
]
const SKIPPED = /^(Merge (branch|pull request|remote-tracking)|Revert ")/

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '')
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/** The generated part of a changelog section: plain bullet groups, newest first. */
export function changelogFromCommits(commits: Commit[]): string {
  const parsed = commits.filter((c) => !SKIPPED.test(c.subject)).map(parseCommit)
  const blocks: string[] = []
  const breaking = parsed.filter((c) => c.breaking)
  if (breaking.length > 0) {
    blocks.push(`### Important\n\n${unique(breaking.map((c) => `- ${sentence(c.subject)}`))}`)
  }
  for (const group of GROUPS) {
    const lines = parsed
      .filter((c) => !c.breaking && group.types.includes(c.type))
      .map((c) => `- ${sentence(c.subject)}`)
    if (lines.length > 0) blocks.push(`### ${group.title}\n\n${unique(lines)}`)
  }
  return blocks.join('\n\n')
}

function unique(lines: string[]): string {
  return [...new Set(lines)].join('\n')
}

/** The body of `## Unreleased` (empty string when there is none). */
export function unreleasedBody(changelog: string): string {
  const match = /^## Unreleased[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(changelog)
  return match ? (match[1] ?? '').trim() : ''
}

/**
 * Moves the Unreleased notes plus the generated lines under
 * `## <version> — <date>` and leaves an empty `## Unreleased` above it.
 */
export function insertRelease(
  changelog: string,
  version: string,
  date: string,
  generated: string
): string {
  if (new RegExp(`^## ${escapeRe(version)}\\b`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  }
  const notes = [unreleasedBody(changelog), generated].filter((part) => part.length > 0)
  const body = notes.length > 0 ? notes.join('\n\n') : '- Small fixes and improvements.'
  const section = `## ${version} — ${date}\n\n${body}\n`
  const unreleased = /^## Unreleased[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m
  if (unreleased.test(changelog)) {
    return changelog
      .replace(unreleased, () => `## Unreleased\n\n${section}\n`)
      .replace(/\n*$/, '\n')
  }
  const heading = /^# [^\n]*\n/m.exec(changelog)
  const at = heading ? heading.index + heading[0].length : 0
  return `${changelog.slice(0, at)}\n## Unreleased\n\n${section}\n${changelog.slice(at).replace(/^\n+/, '')}`.replace(
    /\n*$/,
    '\n'
  )
}

/** The text under `## <version>`, for the GitHub Release body. */
export function changelogSection(changelog: string, version: string): string | null {
  version = version.replace(/^v/, '')
  const re = new RegExp(
    `^## v?${escapeRe(version)}(?: [^\\n]*)?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
    'm'
  )
  const match = re.exec(changelog)
  return match ? (match[1] ?? '').trim() : null
}

/** Release notes: the changelog section, then which file to pick, how to open it and how to check a download. */
export function releaseNotes(changelog: string, version: string): string {
  const section = changelogSection(changelog, version)
  if (section === null) throw new Error(`CHANGELOG.md has no "## ${version}" section`)
  const pre = parseVersion(version).pre !== null
  return [
    pre
      ? '> **Beta.** This is a test build. Expect rough edges, and keep a backup of your projects.\n'
      : '',
    section,
    '',
    '---',
    '',
    '### Which file do I need?',
    '',
    '- **Mac:** `CiteFox-' +
      version +
      '-mac-universal.dmg` works on every Mac. The `-arm64` (Apple chip) and `-x64` (Intel) files are smaller.',
    '- **Windows:** `CiteFox-' +
      version +
      '-win-x64.exe` is the installer (`-arm64` for Windows on Arm). `-portable.exe` runs without installing.',
    '- **Linux:** the `.AppImage` runs anywhere; the `.deb` is for Ubuntu and Debian.',
    '',
    '### Opening it the first time',
    '',
    '- **Mac:** signed and notarized by Apple, so it opens like any other app. If macOS says it was downloaded from the internet, click **Open**.',
    '- **Windows:** the Windows build is not signed with a paid certificate yet. When SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. You only do this once.',
    '- **Linux:** nothing special. For the AppImage, make it executable first (`chmod +x`).',
    '',
    'Check a download against `SHA256SUMS.txt`: `shasum -a 256 <file>` (Mac, Linux) or `Get-FileHash <file>` (Windows).'
  ]
    .filter((line, i) => i > 0 || line !== '')
    .join('\n')
    .trim()
    .concat('\n')
}

/** Sets the top-level `"version"` in package.json without reformatting it. */
export function setPackageVersion(text: string, version: string): string {
  const re = /^(\s{2}"version":\s*")[^"]*(")/m
  if (!re.test(text)) throw new Error('package.json has no top-level "version"')
  return text.replace(re, `$1${version}$2`)
}

/** Sets the root version in package-lock.json (top level and `packages[""]`). */
export function setLockVersion(text: string, version: string): string {
  const lock = JSON.parse(text) as {
    version?: string
    packages?: Record<string, { version?: string }>
  }
  lock.version = version
  const root = lock.packages?.['']
  if (root) root.version = version
  return `${JSON.stringify(lock, null, 2)}\n`
}

/** YYYY-MM-DD in the owner's zone (America/Toronto). */
export function torontoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---- Command line -------------------------------------------------------

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function lastTag(): string | null {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'])
  } catch {
    return null
  }
}

/** The branch's upstream remote, else the GitHub remote, else `origin`. */
function pushRemote(branch: string): string {
  try {
    const upstream = git(['config', `branch.${branch}.remote`])
    if (upstream) return upstream
  } catch {
    // No upstream set.
  }
  const github = git(['remote', '-v'])
    .split('\n')
    .find((line) => /github\.com[:/]/.test(line))
  return github?.split(/\s/)[0] || 'origin'
}

function commitsSince(tag: string): Commit[] {
  const out = git(['log', `${tag}..HEAD`, '--no-merges', '--format=%s%x1f%b%x1e'])
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x1f')
      return { subject, body }
    })
}

function run(script: string): void {
  console.log(`\n> npm run ${script}`)
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
}

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

const USAGE = `Usage:
  npm run release -- patch|minor|major [--beta] [--dry-run]
  node scripts/release.ts notes v<version>`

function main(argv: string[]): void {
  const root = resolve(import.meta.dirname, '..')
  const changelogPath = resolve(root, 'CHANGELOG.md')

  if (argv[0] === 'notes') {
    const version = (argv[1] ?? '').replace(/^v/, '')
    if (!version) fail(USAGE)
    process.stdout.write(releaseNotes(readFileSync(changelogPath, 'utf8'), version))
    return
  }

  const kind = argv[0]
  if (kind !== 'patch' && kind !== 'minor' && kind !== 'major') fail(USAGE)
  const beta = argv.includes('--beta')
  const dryRun = argv.includes('--dry-run')

  const pkgPath = resolve(root, 'package.json')
  const lockPath = resolve(root, 'package-lock.json')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const current = (JSON.parse(pkgText) as { version: string }).version
  const version = nextVersion(current, kind, beta)
  const tag = `v${version}`
  const date = torontoDate(new Date())
  const previous = lastTag()
  const commits = previous ? commitsSince(previous) : []
  const generated = changelogFromCommits(commits)
  const changelog = insertRelease(readFileSync(changelogPath, 'utf8'), version, date, generated)

  console.log(`CiteFox ${current} → ${version}${beta ? ' (beta)' : ''}`)
  console.log(
    previous
      ? `${commits.length} commit(s) since ${previous}.`
      : 'No earlier tag: the section uses the Unreleased notes only.'
  )

  if (dryRun) {
    console.log(`\n--- CHANGELOG section (dry run, nothing changed) ---\n`)
    console.log(changelogSection(changelog, version))
    return
  }

  if (git(['status', '--porcelain']).length > 0)
    fail('the working tree is not clean. Commit or stash first.')
  if (git(['tag', '--list', tag]).length > 0) fail(`tag ${tag} already exists.`)

  // build before test:unit: real-data-guard.test.ts checks the built bundle in out/.
  for (const script of ['typecheck', 'lint', 'build', 'test:unit']) {
    try {
      run(script)
    } catch {
      fail(`npm run ${script} failed. Nothing was changed.`)
    }
  }

  writeFileSync(pkgPath, setPackageVersion(pkgText, version))
  writeFileSync(lockPath, setLockVersion(readFileSync(lockPath, 'utf8'), version))
  writeFileSync(changelogPath, changelog)
  git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'])
  git(['commit', '-m', `chore(release): ${tag}`])
  git(['tag', '-a', tag, '-m', `CiteFox ${version}`])

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  console.log(`\nCommitted and tagged ${tag}. Nothing was pushed.`)
  console.log(`Read the CHANGELOG section once more, then push to start the release build:\n`)
  console.log(`  git push ${pushRemote(branch)} ${branch} ${tag}\n`)
  console.log(`To undo before pushing: git tag -d ${tag} && git reset --hard HEAD~1`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2))
}
