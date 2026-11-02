// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FaviconRequest, FaviconResult } from '@shared/ipc'
import { iconKey, setFetchIconsForTests } from './loader'
import { SiteIcon, SiteLabel } from './SiteIcon'
import { SITE_TONES, siteTone } from './tone'

const ICON = 'data:image/png;base64,iVBORw0KGgo='

afterEach(() => {
  cleanup()
  setFetchIconsForTests(null)
  vi.useRealTimers()
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

describe('SiteIcon', () => {
  it('shows a letter tile at once, then the icon main sent', async () => {
    const calls: FaviconRequest[] = []
    setFetchIconsForTests((request) => {
      calls.push(request)
      return Promise.resolve({
        icons: request.domains.map((domain) => ({
          domain,
          dataUri: domain === 'textbolt.com' ? ICON : null
        }))
      })
    })
    const view = render(
      <>
        <SiteLabel domain="https://www.TextBolt.com/pricing">textbolt.com</SiteLabel>
        <SiteIcon domain="nofav.com" />
        <SiteIcon domain="textbolt.com" />
      </>
    )
    const tiles = view.container.querySelectorAll('[data-site-icon-state="loading"]')
    expect(tiles).toHaveLength(3)
    expect(tiles[0]?.getAttribute('data-letter')).toBe('T')
    expect(tiles[0]?.textContent).toBe('')
    await flush()
    // One batch for every icon asked for in the same moment, each domain once.
    expect(calls).toEqual([{ domains: ['textbolt.com', 'nofav.com'] }])
    const images = view.container.querySelectorAll('img.site-icon')
    expect(images).toHaveLength(2)
    expect(images[0]?.getAttribute('src')).toBe(ICON)
    expect(images[0]?.getAttribute('alt')).toBe('')
    const none = view.container.querySelector('[data-site-icon="nofav.com"]')
    expect(none?.getAttribute('data-site-icon-state')).toBe('none')
    expect(none?.getAttribute('data-letter')).toBe('N')
    expect(view.getByText('textbolt.com')).toBeTruthy()
  })

  it('keeps the letter tile when the call fails or icons are off', async () => {
    setFetchIconsForTests(() => Promise.reject(new Error('offline')))
    const view = render(<SiteIcon domain="a.com" />)
    await flush()
    expect(view.container.querySelector('img')).toBeNull()
    cleanup()
    setFetchIconsForTests(() => Promise.resolve({ icons: [] } satisfies FaviconResult))
    const off = render(<SiteIcon domain="b.com" size={20} />)
    await flush()
    expect(off.container.querySelector('img')).toBeNull()
    expect(off.container.querySelector('.site-icon-20')?.getAttribute('data-letter')).toBe('B')
  })

  it('never puts anything but an image data URI in the img', async () => {
    setFetchIconsForTests((request) =>
      Promise.resolve({
        icons: request.domains.map((domain) => ({ domain, dataUri: 'https://evil.example/x.png' }))
      })
    )
    const view = render(<SiteIcon domain="c.com" />)
    await flush()
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('asks for a domain only once across renders', async () => {
    const fetcher = vi.fn((request: FaviconRequest) =>
      Promise.resolve({ icons: request.domains.map((domain) => ({ domain, dataUri: ICON })) })
    )
    setFetchIconsForTests(fetcher)
    const first = render(<SiteIcon domain="d.com" />)
    await flush()
    first.unmount()
    const second = render(<SiteIcon domain="D.com" />)
    expect(second.container.querySelector('img')?.getAttribute('src')).toBe(ICON)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('gives each domain the same letter-tile colour every time, and a globe to a name with no domain', () => {
    setFetchIconsForTests(() => Promise.resolve({ icons: [] }))
    expect(siteTone('twilio.com')).toBe(siteTone('twilio.com'))
    const tones = new Set(
      ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com', 'g.com', 'h.com'].map(siteTone)
    )
    expect(tones.size).toBeGreaterThan(2)
    for (const tone of tones) expect(tone).toBeLessThan(SITE_TONES)
    const view = render(
      <>
        <SiteIcon domain="https://www.twilio.com/x" />
        <SiteIcon domain="localhost" />
        <SiteIcon domain="" />
      </>
    )
    const tile = view.container.querySelector('[data-site-icon="twilio.com"]')
    expect(tile?.className).toContain(`site-icon-tone-${siteTone('twilio.com')}`)
    expect(view.container.querySelectorAll('.site-icon-globe')).toHaveLength(2)
  })

  it('asks only for icons still on screen when the batch goes out', async () => {
    const calls: FaviconRequest[] = []
    setFetchIconsForTests((request) => {
      calls.push(request)
      return Promise.resolve({ icons: [] })
    })
    const gone = render(<SiteIcon domain="scrolled-away.com" />)
    const kept = render(<SiteIcon domain="on-screen.com" />)
    gone.unmount()
    await flush()
    expect(calls).toEqual([{ domains: ['on-screen.com'] }])
    kept.unmount()
    // Back on screen later: asked for then.
    render(<SiteIcon domain="scrolled-away.com" />)
    await flush()
    expect(calls).toEqual([{ domains: ['on-screen.com'] }, { domains: ['scrolled-away.com'] }])
  })

  it('normalises keys the way main does', () => {
    expect(iconKey('HTTPS://www.Example.com:443/x?y')).toBe('example.com')
  })
})
