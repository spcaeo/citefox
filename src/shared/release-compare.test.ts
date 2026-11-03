import { describe, expect, it } from 'vitest'
import {
  buildOfRelease,
  compareVersions,
  githubSlug,
  isNewerRelease,
  pickReleaseAsset,
  versionOfTag
} from './release-compare'

describe('version comparison', () => {
  it('orders versions by number, not text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3', '1.3.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
  })

  it('an unreadable version is never newer', () => {
    expect(compareVersions('nightly', '0.1.0')).toBeLessThan(0)
    expect(
      isNewerRelease({ version: 'nightly', build: 9999 }, { version: '0.1.0', build: 1 })
    ).toBe(false)
  })

  it('compares the version, then the build number', () => {
    const current = { version: '0.12.0', build: 1424 }
    expect(isNewerRelease({ version: '0.13.0', build: 1 }, current)).toBe(true)
    expect(isNewerRelease({ version: '0.11.9', build: 9999 }, current)).toBe(false)
    expect(isNewerRelease({ version: '0.12.0', build: 1500 }, current)).toBe(true)
    expect(isNewerRelease({ version: '0.12.0', build: 1424 }, current)).toBe(false)
    expect(isNewerRelease({ version: '0.12.0', build: null }, current)).toBe(false)
    expect(
      isNewerRelease({ version: '0.12.0', build: 1500 }, { version: '0.12.0', build: null })
    ).toBe(false)
  })

  it('reads the version and build from a release', () => {
    expect(versionOfTag('v0.13.0')).toBe('0.13.0')
    expect(versionOfTag('v0.13.0+1500')).toBe('0.13.0')
    expect(versionOfTag('release-13')).toBeNull()
    expect(buildOfRelease({ tag: 'v0.13.0+1500' })).toBe(1500)
    expect(buildOfRelease({ tag: 'v0.13.0', name: 'CiteFox v0.13.0 · build 1501' })).toBe(1501)
    expect(buildOfRelease({ tag: 'v0.13.0', name: 'v0.13.0', body: 'Build 1502, Nov 9' })).toBe(
      1502
    )
    expect(buildOfRelease({ tag: 'v0.13.0', name: 'v0.13.0' })).toBeNull()
  })
})

describe('the download for this computer', () => {
  const assets = [
    { name: 'CiteFox-0.13.0-universal.dmg', url: 'https://github.com/a/mac-u' },
    { name: 'CiteFox-0.13.0-arm64.dmg', url: 'https://github.com/a/mac-arm' },
    { name: 'CiteFox-0.13.0-arm64-mac.zip', url: 'https://github.com/a/zip' },
    { name: 'CiteFox-Setup-0.13.0-x64.exe.blockmap', url: 'https://github.com/a/bm' },
    { name: 'CiteFox-Setup-0.13.0-x64.exe', url: 'https://github.com/a/win' },
    { name: 'CiteFox-0.13.0-arm64.AppImage', url: 'https://github.com/a/linux-arm' },
    { name: 'CiteFox-0.13.0-x86_64.AppImage', url: 'https://github.com/a/linux-x64' },
    { name: 'citefox_0.13.0_amd64.deb', url: 'https://github.com/a/deb' }
  ]

  it('picks the universal Mac disk image first', () => {
    expect(pickReleaseAsset(assets, 'darwin', 'arm64')?.url).toBe('https://github.com/a/mac-u')
    expect(pickReleaseAsset(assets.slice(1), 'darwin', 'arm64')?.url).toBe(
      'https://github.com/a/mac-arm'
    )
  })

  it('picks the Windows installer, never its blockmap', () => {
    expect(pickReleaseAsset(assets, 'win32', 'x64')?.url).toBe('https://github.com/a/win')
  })

  it('prefers the installer over a portable build listed first', () => {
    const withPortable = [
      { name: 'CiteFox-0.13.0-x64-portable.exe', url: 'https://github.com/a/portable' },
      ...assets
    ]
    expect(pickReleaseAsset(withPortable, 'win32', 'x64')?.url).toBe('https://github.com/a/win')
    const onlyPortable = withPortable.filter((a) => /portable/.test(a.name))
    expect(pickReleaseAsset(onlyPortable, 'win32', 'x64')?.url).toBe(
      'https://github.com/a/portable'
    )
  })

  it('picks the AppImage for the Linux arch', () => {
    expect(pickReleaseAsset(assets, 'linux', 'x64')?.url).toBe('https://github.com/a/linux-x64')
    expect(pickReleaseAsset(assets, 'linux', 'arm64')?.url).toBe('https://github.com/a/linux-arm')
  })

  it('has nothing for an unknown system or a release without installers', () => {
    expect(pickReleaseAsset(assets, 'freebsd', 'x64')).toBeNull()
    expect(pickReleaseAsset([], 'darwin', 'arm64')).toBeNull()
  })

  it('reads the GitHub repo from package.json', () => {
    expect(githubSlug({ type: 'git', url: 'git+https://github.com/spcaeo/citefox.git' })).toBe(
      'spcaeo/citefox'
    )
    expect(githubSlug('github:spcaeo/citefox')).toBe('spcaeo/citefox')
    expect(githubSlug({ url: 'https://gitlab.com/x/y' })).toBeNull()
  })
})
