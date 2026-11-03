// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Renders site/index.html with site/app.js against a stubbed GitHub API. */
const V = '0.13.0'
const file = (name: string, size: number): Record<string, unknown> => ({
  name,
  size,
  browser_download_url: `https://github.com/spcaeo/citefox/releases/download/v${V}/${name}`,
  digest: name.endsWith('.txt') || name.endsWith('.yml') ? null : `sha256:${'c'.repeat(64)}`
})
const release = {
  tag_name: `v${V}`,
  published_at: '2026-11-02T14:00:00Z',
  body: '### New\n\n- Share a report as a link\n\n---\n\n### Which file do I need?\n',
  assets: [
    file(`CiteFox-${V}-mac-universal.dmg`, 240e6),
    file(`CiteFox-${V}-mac-arm64.dmg`, 120e6),
    file(`CiteFox-${V}-mac-x64.dmg`, 125e6),
    file(`CiteFox-${V}-win-x64.exe`, 110e6),
    file(`CiteFox-${V}-linux-x86_64.AppImage`, 148e6),
    file('latest.yml', 400),
    file('SHA256SUMS.txt', 600)
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('download page in a browser', () => {
  it('offers the universal Mac file for an unknown chip, fills every card, lists files with copy icons and the notes', async () => {
    const html = readFileSync(resolve('site/download/index.html'), 'utf8')
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
    const meta = document.createElement('meta')
    meta.name = 'citefox-repo'
    meta.content = 'spcaeo/citefox'
    document.head.append(meta)
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      configurable: true
    })
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await import(pathToFileURL(resolve('site/app.js')).href)
    const main = (): HTMLAnchorElement =>
      document.querySelector('[data-dl-main]') as HTMLAnchorElement
    await vi.waitFor(() => expect(main().dataset.state).toBe('ready'))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/spcaeo/citefox/releases/latest',
      expect.anything()
    )
    // Safari hides the chip, so the big button offers the file for every Mac.
    expect(main().href).toBe(release.assets[0]?.browser_download_url)
    expect(main().textContent).toContain('Mac')
    expect(document.querySelector('[data-dl-also]')?.textContent).toContain('every Mac')
    expect(document.querySelector('[data-dl-meta]')?.textContent).toContain(`v${V}`)
    // The OS cards: files in this release get real links, missing ones hide.
    const link = (key: string): HTMLAnchorElement =>
      document.querySelector(`[data-asset="${key}"]`) as HTMLAnchorElement
    expect(link('mac-arm64-dmg').href).toBe(release.assets[1]?.browser_download_url)
    expect(link('win-x64-installer').href).toBe(release.assets[3]?.browser_download_url)
    expect(link('linux-x64-appimage').href).toBe(release.assets[4]?.browser_download_url)
    for (const card of document.querySelectorAll<HTMLElement>('.os-card')) {
      expect(card.dataset.state).toBe('ready')
    }
    expect(document.querySelector('.os-card[data-os="mac"]')?.classList.contains('own')).toBe(true)

    const rows = document.querySelectorAll('#files li')
    expect(rows).toHaveLength(5)
    expect(document.querySelectorAll('#files .copy-btn').length).toBe(10)
    expect(document.querySelector('#sums .open-btn')?.getAttribute('target')).toBe('_blank')
    // Commands written in the page get the same copy helper.
    expect(document.querySelectorAll('#unsigned .copyable').length).toBeGreaterThanOrEqual(2)
    expect(document.querySelector('#notes')?.innerHTML).toContain(
      '<li>Share a report as a link</li>'
    )
    expect(document.querySelector('#notes')?.textContent).not.toContain('Which file')
    expect((document.querySelector('#files-section') as HTMLElement).hidden).toBe(false)
  })
})
