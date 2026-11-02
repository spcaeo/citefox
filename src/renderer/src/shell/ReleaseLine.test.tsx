// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { appBuild } from '../../../main/build-info'
import { makeAppInfo } from '../../../main/app-info'
import packageJson from '../../../../package.json'
import { resetAppInfoCache } from '../buildMenu/appInfoStore'
import type { BuildClient } from '../buildMenu/buildClient'
import { BuildToolsHost } from '../buildMenu/BuildToolsHost'
import { ReleaseLine } from './ReleaseLine'
import { resetUpdateStore } from '../updates/updateStore'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
  resetUpdateStore()
})

function clientFor(info: ReturnType<typeof makeAppInfo>): BuildClient {
  return {
    getInfo: () => Promise.resolve(info),
    resetKeepKeys: () => Promise.resolve({ ok: true }),
    openTestProfile: () => Promise.resolve({ ok: true, alreadyOpen: false })
  }
}

describe('the footer release line', () => {
  it('shows what main serves: package.json version and the stamped build, in Toronto time', async () => {
    // What electron.vite.config.ts injects as __CITEFOX_BUILD__ for a bundled build.
    const stamped = { commit: 'fae9b4e', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
    const info = makeAppInfo(appBuild(stamped), false)
    expect(info.version).toBe(packageJson.version)
    expect(info.build.number).toBe(stamped.number)

    const view = render(
      <BuildToolsHost client={clientFor(info)}>
        <ReleaseLine />
      </BuildToolsHost>
    )
    const footer = await view.findByRole('contentinfo', { name: 'Release' })
    expect(footer.textContent).toContain(
      `v${packageJson.version} · build 1424 · Nov 2, 2026 8:49 AM EST`
    )
  })

  it('an unbundled run shows the version without a build number', async () => {
    const info = makeAppInfo(appBuild(undefined), false)
    const view = render(
      <BuildToolsHost client={clientFor(info)}>
        <ReleaseLine />
      </BuildToolsHost>
    )
    const footer = await view.findByRole('contentinfo', { name: 'Release' })
    expect(footer.textContent).toMatch(
      new RegExp(`^v${packageJson.version.replace(/\./g, '\\.')} · `)
    )
    expect(footer.textContent).not.toContain('build ')
  })

  it('adds a dot and "vX available" when a newer release exists', async () => {
    const download =
      'https://github.com/spcaeo/citefox/releases/download/v9.0.0/CiteFox-9.0.0-universal.dmg'
    const latest = { version: '9.0.0', build: null, notesUrl: download, downloadUrl: download }
    const status = { available: true, latest, dismissed: true, checkedAt: null, failed: false }
    resetUpdateStore({
      get: () => Promise.resolve(status),
      check: () => Promise.resolve(status),
      dismiss: () => Promise.resolve(status)
    })
    const view = render(
      <BuildToolsHost client={clientFor(makeAppInfo(appBuild(undefined), false))}>
        <ReleaseLine />
      </BuildToolsHost>
    )
    const link = await view.findByRole('link', { name: 'v9.0.0 available' })
    expect(link.getAttribute('href')).toBe(download)
  })
})
