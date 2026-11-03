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
  assetsByKey(assets: Asset[]): Record<string, Asset>
  pickMain(
    assets: Asset[],
    platform: Platform,
    version?: string
  ): { asset: Asset; title: string; sub: string } | null
  releaseState(status: number, release: unknown): 'ready' | 'none' | 'error'
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

describe('download page: the one big button and the OS cards', () => {
  it('says Download for <OS> with version, file type and size', () => {
    const mac = m.pickMain(assets, { os: 'mac', arch: 'unknown' }, '0.13.0')
    expect(mac?.asset.name).toBe(`CiteFox-${V}-mac-universal.dmg`)
    expect(mac?.title).toBe('Download for Mac')
    expect(mac?.sub).toBe('v0.13.0 · Universal .dmg · 10 MB')
    expect(m.pickMain(assets, { os: 'mac', arch: 'arm64' }, '0.13.0')?.sub).toContain(
      'Apple chip .dmg'
    )
    const win = m.pickMain(assets, { os: 'win', arch: 'x64' }, '0.13.0')
    expect(win?.title).toBe('Download for Windows')
    expect(win?.sub).toContain('Installer .exe')
    expect(m.pickMain(assets, { os: 'linux', arch: 'x64' })?.title).toBe('Download for Linux')
    expect(m.pickMain(assets, { os: 'mobile', arch: 'unknown' })).toBeNull()
  })

  it('tells a missing release, a release still being built and an error apart', () => {
    expect(m.releaseState(404, null)).toBe('none')
    expect(m.releaseState(200, { tag_name: 'v0.13.0', assets: [] })).toBe('none')
    expect(m.releaseState(200, { tag_name: 'v0.13.0', assets })).toBe('ready')
    expect(m.releaseState(403, null)).toBe('error')
    expect(m.releaseState(0, null)).toBe('error')
  })

  it('has a release file for every card link, by the CI file names', () => {
    const byKey = m.assetsByKey(assets)
    for (const file of ['index.html', 'download/index.html']) {
      const html = readFileSync(resolve(site, file), 'utf8')
      const keys = [...html.matchAll(/data-asset="([^"]+)"/g)].map((x) => x[1]!)
      expect(keys).toHaveLength(11)
      for (const key of keys) expect(byKey[key], key).toBeDefined()
    }
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
  // The download section is on the home page and on its own /download/ page.
  const pages = ['index.html', 'download/index.html'].map((file) => ({
    file,
    html: readFileSync(resolve(site, file), 'utf8')
  }))
  const app = readFileSync(resolve(site, 'app.js'), 'utf8')
  const lib = readFileSync(resolve(site, 'release.js'), 'utf8')
  const zoom = readFileSync(resolve(site, 'lightbox.js'), 'utf8')

  it.each(pages)('copies only through the one copyable helper ($file)', ({ html }) => {
    expect(app).not.toMatch(/clipboard/)
    expect(zoom).not.toMatch(/clipboard/)
    expect(html).not.toMatch(/clipboard/)
    // The only button written in a page is the hero video's Sound on toggle.
    expect(html.replace(/<button[^>]*data-sound[^>]*>/, '')).not.toMatch(/<button/)
    expect(lib.match(/clipboard/g)).toHaveLength(1)
    // app.js builds no code elements or buttons of its own.
    expect(app).not.toMatch(/createElement\(['"](code|button)['"]\)/)
  })

  it('builds buttons only for the screenshot zoom: close, previous and next', () => {
    // lightbox.js makes its buttons in one helper, each with a label; none copies.
    expect(zoom.match(/createElement\('button'\)/g)).toHaveLength(1)
    const labels = [...zoom.matchAll(/iconButton\(doc, '[^']+', '([^']+)'/g)].map((x) => x[1])
    expect(labels).toEqual(['Close', 'Previous screenshot', 'Next screenshot'])
  })

  it('marks every command in the pages for a copy icon', () => {
    const codes = pages.flatMap(({ html }) => [...html.matchAll(/<code([^>]*)>([^<]*)<\/code>/g)])
    expect(codes.length).toBeGreaterThan(0)
    for (const [, attrs, text] of codes) {
      // A bare file extension (.dmg) is prose; anything else people would copy.
      if (/^\.[a-z]+$/i.test(text ?? '')) continue
      expect(attrs, text).toContain('data-copy')
    }
  })

  it.each(pages)(
    'opens every outside link in a new window and shows the license line ($file)',
    ({ html }) => {
      for (const [tag] of html.matchAll(/<a [^>]*href="https?:[^>]*>/g)) {
        expect(tag).toContain('target="_blank"')
        expect(tag).toContain('rel="noopener"')
      }
      expect(html).toContain('Source-available')
      expect(html).toMatch(/© 2026 <a [^>]*>Space-O Technologies<\/a>/)
      expect(html).toMatch(/href="[^"]*LICENSE"/)
      // The unsigned-app tip in the install strip.
      expect(html).toContain('Run anyway')
    }
  )

  it('keeps the full first-start steps and every file on /download/', () => {
    const download = pages[1]!.html
    expect(download).toContain('notarized by Apple')
    expect(download).toContain('id="unsigned"')
    expect(download).toContain('id="files-section"')
  })

  it('shows the big button, three OS cards, the install strip and the release row', () => {
    for (const { html } of pages) {
      expect(html.match(/data-dl-main/g)).toHaveLength(1)
      expect(html.match(/class="os-card"/g)).toHaveLength(3)
      expect(html).toContain('class="install"')
      for (const label of ['Release notes', 'Older versions', 'Checksums (SHA-256)'])
        expect(html).toContain(label)
    }
    // The home hero keeps the product video and its Sound on button.
    expect(pages[0]!.html).toContain('data-sound')
  })
})
