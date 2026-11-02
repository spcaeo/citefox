/**
 * "Is there a newer CiteFox?" from a GitHub release: compare the version
 * first, then the build number, and pick the download for this computer.
 * Pure, so the update check and its tests share it (src/main/updates).
 */

export interface ReleaseId {
  version: string
  /** The build number that only goes up, or null when unknown. */
  build: number | null
}

interface Semver {
  core: [number, number, number]
  /** Pre-release words after `-` ("beta.2"), or empty for a release. */
  pre: string[]
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** `v0.13.0`, `0.13.0-beta.1`; null for anything else. */
export function parseVersion(value: string): Semver | null {
  const match = SEMVER.exec(value.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : []
  }
}

/** The plain version ("0.13.0") from a tag like "v0.13.0" or "v0.13.0+1500"; null if none. */
export function versionOfTag(tag: string): string | null {
  const parsed = parseVersion(tag)
  if (!parsed) return null
  const core = parsed.core.join('.')
  return parsed.pre.length > 0 ? `${core}-${parsed.pre.join('.')}` : core
}

function comparePre(a: string[], b: string[]): number {
  // A release sorts after its pre-releases (semver 11.3).
  if (a.length === 0 || b.length === 0) return b.length - a.length
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x) ? Number(x) : null
    const ny = /^\d+$/.test(y) ? Number(y) : null
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (nx !== null) return -1
    else if (ny !== null) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** <0 when `a` is older, 0 the same, >0 newer. An unreadable version sorts oldest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return (pa.core[i] ?? 0) < (pb.core[i] ?? 0) ? -1 : 1
  }
  return comparePre(pa.pre, pb.pre)
}

/**
 * True when `latest` is newer than `current`: a higher version, or the same
 * version with a higher build number (both known).
 */
export function isNewerRelease(latest: ReleaseId, current: ReleaseId): boolean {
  const byVersion = compareVersions(latest.version, current.version)
  if (byVersion !== 0) return byVersion > 0
  return latest.build !== null && current.build !== null && latest.build > current.build
}

/**
 * The build number a release names: "build 1500" in its name or notes, or a
 * tag like "v0.13.0+1500". Null when it names none.
 */
export function buildOfRelease(input: {
  tag: string
  name?: string | null
  body?: string | null
}): number | null {
  const fromTag = /\+(\d{1,9})$/.exec(input.tag.trim())
  if (fromTag) return Number(fromTag[1])
  for (const text of [input.name, input.body]) {
    const match = text ? /\bbuild\s+(\d{1,9})\b/i.exec(text) : null
    if (match) return Number(match[1])
  }
  return null
}

export interface ReleaseAsset {
  name: string
  url: string
}

/** Which installer suits this computer: a Mac .dmg (universal first), a Windows .exe, a Linux AppImage. */
export function pickReleaseAsset(
  assets: readonly ReleaseAsset[],
  platform: string,
  arch: string
): ReleaseAsset | null {
  const named = (pattern: RegExp): ReleaseAsset[] => assets.filter((a) => pattern.test(a.name))
  const archWords =
    arch === 'arm64' ? /arm64|aarch64/i : arch === 'x64' ? /x64|x86_64|amd64/i : /(?!)/
  const prefer = (list: ReleaseAsset[], ...patterns: RegExp[]): ReleaseAsset | null => {
    for (const pattern of patterns) {
      const hit = list.find((a) => pattern.test(a.name))
      if (hit) return hit
    }
    return list[0] ?? null
  }
  if (platform === 'darwin') return prefer(named(/\.dmg$/i), /universal/i, archWords)
  if (platform === 'win32')
    return prefer(
      named(/\.exe$/i).filter((a) => !/blockmap/i.test(a.name)),
      archWords,
      /setup/i
    )
  if (platform === 'linux') return prefer(named(/\.AppImage$/i), archWords)
  return null
}

/** "owner/repo" from package.json's `repository` (a string or `{ url }`); null when not GitHub. */
export function githubSlug(repository: unknown): string | null {
  const url =
    typeof repository === 'string'
      ? repository
      : typeof repository === 'object' && repository !== null
        ? (repository as { url?: unknown }).url
        : null
  if (typeof url !== 'string') return null
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url)
  if (match) return `${match[1]}/${match[2]}`
  const short = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url)
  return short ? `${short[1]}/${short[2]}` : null
}
