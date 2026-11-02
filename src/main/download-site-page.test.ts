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
  it('shows both Mac buttons for an unknown chip, the files with copy icons and the notes', async () => {
    const html = readFileSync(resolve('site/index.html'), 'utf8')
    document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
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
    await vi.waitFor(() => expect(document.querySelectorAll('#primary a.button').length).toBe(2))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/spcaeo/citefox/releases/latest',
      expect.anything()
    )
    const buttons = [...document.querySelectorAll('#primary a.button')].map((a) => a.textContent)
    expect(buttons[0]).toContain('Mac with Apple chip')
    expect(buttons[1]).toContain('Mac with Intel chip')
    expect(document.querySelector('#primary')?.textContent).toContain('version for every Mac')

    const rows = document.querySelectorAll('#files li')
    expect(rows).toHaveLength(5)
    expect(document.querySelectorAll('#files .copy-btn').length).toBe(10)
    expect(document.querySelector('#sums .open-btn')?.getAttribute('target')).toBe('_blank')
    // Commands written in the page get the same helper.
    expect(document.querySelectorAll('#unsigned .copyable').length).toBe(2)
    // The Mac steps come first for a Mac.
    expect(document.querySelector('.steps .step')?.getAttribute('data-os')).toBe('mac')
    expect(document.querySelector('#notes')?.innerHTML).toContain(
      '<li>Share a report as a link</li>'
    )
    expect(document.querySelector('#notes')?.textContent).not.toContain('Which file')
    expect(document.querySelector('#release-meta')?.textContent).toContain(`Version ${V}`)
    expect((document.querySelector('#files-section') as HTMLElement).hidden).toBe(false)
  })
})
