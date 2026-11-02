import { describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import { memoryAccountStore } from '../account/store'
import type { HttpRequest, HttpTransport } from '../providers/http'
import {
  AUTO_CHECK_GAP_MS,
  createUpdateService,
  readGithubRelease,
  type UpdateService
} from './service'

const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.12.0',
  build: { commit: 'abc1234', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
}
const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

function release(tag: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: tag,
    name: `CiteFox ${tag}`,
    html_url: `https://github.com/spcaeo/citefox/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `CiteFox-${tag.slice(1)}-universal.dmg`,
        browser_download_url: `https://github.com/spcaeo/citefox/releases/download/${tag}/mac.dmg`
      },
      {
        name: `CiteFox-Setup-${tag.slice(1)}-x64.exe`,
        browser_download_url: `https://github.com/spcaeo/citefox/releases/download/${tag}/win.exe`
      }
    ],
    ...extra
  })
}

function fakeGithub(answer: () => { status: number; body: string } | Error): {
  http: HttpTransport
  calls: HttpRequest[]
} {
  const calls: HttpRequest[] = []
  const http: HttpTransport = {
    request(request) {
      calls.push(request)
      const a = answer()
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
    }
  }
  return { http, calls }
}

function service(
  http: HttpTransport,
  over: Partial<Parameters<typeof createUpdateService>[0]> = {}
): UpdateService {
  return createUpdateService({
    store: memoryAccountStore(),
    http,
    appInfo: () => INFO,
    logger: silent,
    repo: 'spcaeo/citefox',
    autoCheck: true,
    platform: 'darwin',
    arch: 'arm64',
    ...over
  })
}

describe('the update check', () => {
  it('finds a newer release and the download for this computer', async () => {
    const github = fakeGithub(() => ({ status: 200, body: release('v0.13.0') }))
    const status = await service(github.http).check()
    expect(github.calls[0]?.url).toBe('https://api.github.com/repos/spcaeo/citefox/releases/latest')
    expect(status).toMatchObject({
      available: true,
      dismissed: false,
      failed: false,
      latest: {
        version: '0.13.0',
        build: null,
        notesUrl: 'https://github.com/spcaeo/citefox/releases/tag/v0.13.0',
        downloadUrl: 'https://github.com/spcaeo/citefox/releases/download/v0.13.0/mac.dmg'
      }
    })
  })

  it('this release or an older one is not an update', async () => {
    for (const tag of ['v0.12.0', 'v0.11.0']) {
      const github = fakeGithub(() => ({ status: 200, body: release(tag) }))
      expect((await service(github.http).check()).available).toBe(false)
    }
  })

  it('the same version with a higher build is an update', async () => {
    const github = fakeGithub(() => ({
      status: 200,
      body: release('v0.12.0', { name: 'CiteFox v0.12.0 · build 1500' })
    }))
    expect((await service(github.http).check()).latest?.build).toBe(1500)
  })

  it('falls back to the release page when no installer fits', async () => {
    const github = fakeGithub(() => ({ status: 200, body: release('v0.13.0', { assets: [] }) }))
    const status = await service(github.http, { platform: 'linux', arch: 'x64' }).check()
    expect(status.latest?.downloadUrl).toBe(
      'https://github.com/spcaeo/citefox/releases/tag/v0.13.0'
    )
  })

  it('dismiss lasts until the next version', async () => {
    let tag = 'v0.13.0'
    const github = fakeGithub(() => ({ status: 200, body: release(tag) }))
    const updates = service(github.http)
    await updates.check()
    expect(updates.dismiss({ version: '0.13.0', build: null }).dismissed).toBe(true)
    expect((await updates.check()).dismissed).toBe(true)
    tag = 'v0.14.0'
    const next = await updates.check()
    expect(next.latest?.version).toBe('0.14.0')
    expect(next.dismissed).toBe(false)
  })

  it('offline or no release yet is quiet', async () => {
    const offline = await service(fakeGithub(() => new Error('offline')).http).check()
    expect(offline).toMatchObject({ available: false, failed: true })
    const none = await service(fakeGithub(() => ({ status: 404, body: '{}' })).http).check()
    expect(none).toMatchObject({ available: false, failed: false })
  })

  it('reads GitHub on its own at most every 12 hours, and never when automatic checks are off', async () => {
    let clock = new Date('2026-11-02T08:00:00Z')
    const github = fakeGithub(() => ({ status: 200, body: release('v0.13.0') }))
    const updates = service(github.http, { now: () => clock })
    await updates.get()
    await updates.get()
    expect(github.calls).toHaveLength(1)
    clock = new Date(clock.getTime() + AUTO_CHECK_GAP_MS)
    await updates.get()
    expect(github.calls).toHaveLength(2)

    const quiet = fakeGithub(() => ({ status: 200, body: release('v0.13.0') }))
    await service(quiet.http, { autoCheck: false }).get()
    expect(quiet.calls).toEqual([])
  })

  it('ignores drafts and links that are not GitHub', () => {
    expect(readGithubRelease(release('v1.0.0', { draft: true }), 'darwin', 'arm64')).toBeNull()
    expect(
      readGithubRelease(
        release('v1.0.0', { html_url: 'https://evil.example/x' }),
        'darwin',
        'arm64'
      )
    ).toBeNull()
  })
})
