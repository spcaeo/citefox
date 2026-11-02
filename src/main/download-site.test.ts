import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/** The download page (site/): plain browser JS, so it is loaded at run time. */
interface Asset {
  name: string
  size: number
  browser_download_url: string
  digest?: string
}
interface Platform {
  os: string
  arch: string
}
interface SiteModule {
  repoFromLocation(hostname: string, pathname: string, fallback?: string): string
  detectPlatform(nav: Record<string, unknown>, hints?: Record<string, string>): Platform
  describeAsset(name: string): { os: string; arch: string; kind: string; label: string } | null
  pickPrimary(assets: Asset[], platform: Platform): { asset: Asset; title: string }[]
  downloadList(assets: Asset[]): { asset: Asset }[]
  formatSize(bytes: number): string
  parseSums(text: string): Record<string, string>
  sha256Of(asset: Asset, sums?: Record<string, string>): string
  renderNotes(markdown: string): string
  shortHash(hex: string): string
}

const site = resolve('site')
let m: SiteModule
beforeAll(async () => {
  m = (await import(pathToFileURL(resolve(site, 'release.js')).href)) as SiteModule
})

const V = '1.3.0'
const names = [
  `CiteFox-${V}-mac-universal.dmg`,
  `CiteFox-${V}-mac-arm64.dmg`,
  `CiteFox-${V}-mac-x64.dmg`,
  `CiteFox-${V}-mac-universal.zip`,
  `CiteFox-${V}-mac-universal.zip.blockmap`,
  `CiteFox-${V}-win-x64.exe`,
  `CiteFox-${V}-win-arm64.exe`,
  `CiteFox-${V}-win-x64-portable.exe`,
  `CiteFox-${V}-win-arm64-portable.exe`,
  `CiteFox-${V}-linux-x86_64.AppImage`,
  `CiteFox-${V}-linux-arm64.AppImage`,
  `CiteFox-${V}-linux-amd64.deb`,
  `CiteFox-${V}-linux-arm64.deb`,
  'latest.yml',
  'latest-mac.yml',
  'SHA256SUMS.txt'
]
const assets: Asset[] = names.map((name, i) => ({
  name,
  size: (i + 1) * 1024 * 1024 * 10,
  browser_download_url: `https://example.test/${name}`
}))
const titles = (platform: Platform): string[] =>
  m.pickPrimary(assets, platform).map((b) => b.asset.name)

describe('download page: platform detection', () => {
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' }

  it('reads the Mac chip from client hints or the GPU, else leaves it unknown', () => {
    expect(m.detectPlatform(mac, { architecture: 'arm' })).toEqual({ os: 'mac', arch: 'arm64' })
    expect(
      m.detectPlatform(mac, { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)' }).arch
    ).toBe('arm64')
    expect(m.detectPlatform(mac, { renderer: 'Intel(R) Iris(TM) Plus Graphics' }).arch).toBe('x64')
    expect(m.detectPlatform(mac, { renderer: 'Apple GPU' }).arch).toBe('unknown')
    expect(m.detectPlatform(mac).arch).toBe('unknown')
  })

  it('tells Windows, Linux and phones apart', () => {
    expect(
      m.detectPlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32'
      })
    ).toEqual({
      os: 'win',
      arch: 'x64'
    })
    expect(
      m.detectPlatform({ userAgent: 'Windows NT 10.0', platform: 'Win32' }, { architecture: 'arm' })
        .arch
    ).toBe('arm64')
    expect(
      m.detectPlatform({ userAgent: 'X11; Linux aarch64', platform: 'Linux aarch64' })
    ).toEqual({
      os: 'linux',
      arch: 'arm64'
    })
    expect(
      m.detectPlatform({
        userAgent: 'iPhone; CPU iPhone OS 18_0 like Mac OS X',
        platform: 'iPhone'
      }).os
    ).toBe('mobile')
    // iPadOS asks for the desktop site and says Macintosh; it has touch.
    expect(m.detectPlatform({ ...mac, maxTouchPoints: 5 }).os).toBe('mobile')
  })

  it('finds the repo on a github.io address', () => {
    expect(m.repoFromLocation('spcaeo.github.io', '/citefox/')).toBe('spcaeo/citefox')
    expect(m.repoFromLocation('citefox.app', '/')).toBe('spcaeo/citefox')
    expect(m.repoFromLocation('localhost', '/', 'me/fork')).toBe('me/fork')
  })
})

describe('download page: buttons and files', () => {
  it('shows both Mac buttons when the chip is unknown, one when it is known', () => {
    expect(titles({ os: 'mac', arch: 'unknown' })).toEqual([
      `CiteFox-${V}-mac-arm64.dmg`,
      `CiteFox-${V}-mac-x64.dmg`
    ])
    expect(titles({ os: 'mac', arch: 'arm64' })).toEqual([`CiteFox-${V}-mac-arm64.dmg`])
    expect(titles({ os: 'mac', arch: 'x64' })).toEqual([`CiteFox-${V}-mac-x64.dmg`])
    const onlyUniversal = assets.filter((a) => !/-mac-(arm64|x64)\.dmg$/.test(a.name))
    expect(
      m.pickPrimary(onlyUniversal, { os: 'mac', arch: 'unknown' }).map((b) => b.asset.name)
    ).toEqual([`CiteFox-${V}-mac-universal.dmg`])
  })

  it('offers the installer, not the portable build, on Windows; the AppImage on Linux', () => {
    expect(titles({ os: 'win', arch: 'x64' })).toEqual([`CiteFox-${V}-win-x64.exe`])
    expect(titles({ os: 'win', arch: 'arm64' })).toEqual([`CiteFox-${V}-win-arm64.exe`])
    expect(titles({ os: 'linux', arch: 'x64' })).toEqual([`CiteFox-${V}-linux-x86_64.AppImage`])
    expect(titles({ os: 'mobile', arch: 'unknown' })).toEqual([])
  })

  it('lists every download once, in order, without update files', () => {
    const listed = m.downloadList(assets).map((f) => f.asset.name)
    expect(listed).toHaveLength(12)
    expect(listed[0]).toBe(`CiteFox-${V}-mac-universal.dmg`)
    expect(listed.at(-1)).toBe(`CiteFox-${V}-linux-arm64.deb`)
    expect(listed.some((n) => /\.(yml|blockmap|txt)$/.test(n))).toBe(false)
    expect(m.describeAsset(`CiteFox-${V}-win-arm64-portable.exe`)).toMatchObject({
      os: 'win',
      arch: 'arm64',
      kind: 'portable'
    })
    expect(m.describeAsset(`CiteFox-${V}-linux-amd64.deb`)).toMatchObject({
      arch: 'x64',
      kind: 'deb'
    })
  })

  it('reads sizes and checksums', () => {
    expect(m.formatSize(118 * 1024 * 1024)).toBe('118 MB')
    expect(m.formatSize(0)).toBe('')
    const hex = 'a'.repeat(64)
    const sums = m.parseSums(`${hex}  CiteFox-${V}-win-x64.exe\n`)
    expect(m.sha256Of({ ...assets[5]!, digest: undefined }, sums)).toBe(hex)
    expect(m.sha256Of({ ...assets[5]!, digest: `sha256:${'b'.repeat(64)}` }, sums)).toBe(
      'b'.repeat(64)
    )
    expect(m.shortHash(hex)).toBe(`${'a'.repeat(12)}…${'a'.repeat(6)}`)
  })
})

describe('download page: release notes', () => {
  it('escapes HTML, keeps simple formatting and stops at the file guide', () => {
    const html = m.renderNotes(
      '> **Beta.** Test build.\n\n### New\n\n- A <script>x</script> fix with `code` and [a link](https://example.test)\n- [bad](javascript:alert(1))\n\n---\n\n### Which file do I need?\n'
    )
    expect(html).toContain('<blockquote><strong>Beta.</strong> Test build.</blockquote>')
    expect(html).toContain('<h4>New</h4>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain(
      '<a href="https://example.test" target="_blank" rel="noopener">a link</a>'
    )
    expect(html).not.toContain('javascript:alert(1)"')
    expect(html).not.toContain('Which file')
  })
})

describe('download page: owner rules', () => {
  const html = readFileSync(resolve(site, 'index.html'), 'utf8')
  const app = readFileSync(resolve(site, 'app.js'), 'utf8')
  const lib = readFileSync(resolve(site, 'release.js'), 'utf8')

  it('copies only through the one copyable helper', () => {
    expect(app).not.toMatch(/clipboard/)
    expect(html).not.toMatch(/clipboard|<button/)
    expect(lib.match(/clipboard/g)).toHaveLength(1)
    // app.js builds no code elements or buttons of its own.
    expect(app).not.toMatch(/createElement\(['"](code|button)['"]\)/)
  })

  it('marks every command in the page for a copy icon', () => {
    const codes = [...html.matchAll(/<code([^>]*)>([^<]*)<\/code>/g)]
    expect(codes.length).toBeGreaterThan(0)
    for (const [, attrs, text] of codes) {
      // A bare file extension (.dmg) is prose; anything else people would copy.
      if (/^\.[a-z]+$/i.test(text ?? '')) continue
      expect(attrs, text).toContain('data-copy')
    }
  })

  it('opens every outside link in a new window and shows the license line', () => {
    for (const [tag] of html.matchAll(/<a [^>]*href="https?:[^>]*>/g)) {
      expect(tag).toContain('target="_blank"')
      expect(tag).toContain('rel="noopener"')
    }
    expect(html).toContain('Source-available')
    expect(html).toMatch(/© 2026 <a [^>]*>Space-O Technologies<\/a>/)
    expect(html).toMatch(/href="[^"]*LICENSE"/)
    expect(html).toContain('Open Anyway')
    expect(html).toContain('Run anyway')
  })
})
