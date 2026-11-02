import type { AppInfo, DismissUpdateRequest, UpdateRelease, UpdateStatus } from '@shared/ipc'
import {
  buildOfRelease,
  isNewerRelease,
  pickReleaseAsset,
  versionOfTag,
  type ReleaseAsset
} from '@shared/release-compare'
import type { Logger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import { withTimeout } from '../providers/timeout'
import type { AccountStore } from '../account/store'

/** An automatic check reads GitHub at most this often. "Check for updates" always reads. */
export const AUTO_CHECK_GAP_MS = 12 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

/**
 * Download only, on every OS (Docs/RELEASING.md "Updates"): CiteFox shows a
 * banner and opens the right installer in the browser. It does not use
 * electron-updater: unsigned builds would need its update feed and still
 * warn on every install, for little gain.
 */
export interface UpdateServiceDeps {
  store: AccountStore
  http: HttpTransport
  appInfo: () => AppInfo
  logger: Logger
  /** "owner/repo" from package.json `repository`, or null (no check). */
  repo: string | null
  /** True in a packaged app: `updates:get` reads GitHub when the last read is stale. */
  autoCheck: boolean
  now?: () => Date
  platform?: string
  arch?: string
}

export interface UpdateService {
  /** The saved status; reads GitHub first when automatic checks are on and the last read is stale. */
  get(): Promise<UpdateStatus>
  /** Reads GitHub now. */
  check(): Promise<UpdateStatus>
  dismiss(request: unknown): UpdateStatus
}

export function releaseKey(release: { version: string; build: number | null }): string {
  return `${release.version}#${release.build ?? ''}`
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

/** The newest release in GitHub's `releases/latest` answer, or null when it is not one. */
export function readGithubRelease(
  body: string,
  platform: string,
  arch: string
): UpdateRelease | null {
  let value: GithubRelease
  try {
    value = JSON.parse(body) as GithubRelease
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || value.draft === true) return null
  if (typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') return null
  if (!value.html_url.startsWith('https://github.com/')) return null
  const version = versionOfTag(value.tag_name)
  if (version === null) return null
  const assets: ReleaseAsset[] = Array.isArray(value.assets)
    ? value.assets.flatMap((asset: unknown) => {
        if (typeof asset !== 'object' || asset === null) return []
        const a = asset as Record<string, unknown>
        return typeof a.name === 'string' &&
          typeof a.browser_download_url === 'string' &&
          a.browser_download_url.startsWith('https://github.com/')
          ? [{ name: a.name, url: a.browser_download_url }]
          : []
      })
    : []
  const asset = pickReleaseAsset(assets, platform, arch)
  return {
    version,
    build: buildOfRelease({
      tag: value.tag_name,
      name: typeof value.name === 'string' ? value.name : null,
      body: typeof value.body === 'string' ? value.body : null
    }),
    notesUrl: value.html_url,
    downloadUrl: asset?.url ?? value.html_url
  }
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const now = deps.now ?? ((): Date => new Date())
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  let running: Promise<UpdateStatus> | null = null

  function current(): { version: string; build: number | null } {
    const info = deps.appInfo()
    return { version: info.version, build: info.build?.number ?? null }
  }

  function status(): UpdateStatus {
    const saved = deps.store.read().updates
    const latest =
      saved.latest !== null && isNewerRelease(saved.latest, current()) ? saved.latest : null
    return {
      available: latest !== null,
      latest,
      dismissed: latest !== null && saved.dismissed === releaseKey(latest),
      checkedAt: saved.checkedAt,
      failed: saved.failed
    }
  }

  async function read(): Promise<UpdateStatus> {
    if (deps.repo === null) return status()
    const saved = deps.store.read().updates
    try {
      const response = await withTimeout(
        (signal) =>
          deps.http.request({
            method: 'GET',
            url: `https://api.github.com/repos/${deps.repo}/releases/latest`,
            headers: {
              accept: 'application/vnd.github+json',
              'user-agent': 'CiteFox',
              'x-github-api-version': '2022-11-28'
            },
            timeoutMs: TIMEOUT_MS,
            signal,
            maxBodyBytes: 2_000_000
          }),
        TIMEOUT_MS,
        'CiteFox updates'
      )
      // 404: no release published yet. Not a failure.
      const latest =
        response.status === 200 ? readGithubRelease(response.body, platform, arch) : null
      const failed = response.status !== 200 && response.status !== 404
      deps.store.update({
        updates: {
          ...saved,
          checkedAt: now().toISOString(),
          latest: failed ? saved.latest : latest,
          failed
        }
      })
    } catch {
      deps.logger.info('CiteFox updates: could not read the newest release')
      deps.store.update({ updates: { ...saved, checkedAt: now().toISOString(), failed: true } })
    }
    return status()
  }

  function check(): Promise<UpdateStatus> {
    if (running === null) {
      running = read().finally(() => {
        running = null
      })
    }
    return running
  }

  return {
    async get() {
      if (!deps.autoCheck) return status()
      const checkedAt = deps.store.read().updates.checkedAt
      const age = checkedAt ? now().getTime() - Date.parse(checkedAt) : Infinity
      return age >= AUTO_CHECK_GAP_MS ? check() : status()
    },
    check,
    dismiss(request) {
      const r = (
        typeof request === 'object' && request !== null ? request : {}
      ) as Partial<DismissUpdateRequest>
      if (typeof r.version === 'string' && r.version.length <= 40) {
        const build = typeof r.build === 'number' && Number.isInteger(r.build) ? r.build : null
        const saved = deps.store.read().updates
        deps.store.update({
          updates: { ...saved, dismissed: releaseKey({ version: r.version, build }) }
        })
      }
      return status()
    }
  }
}
