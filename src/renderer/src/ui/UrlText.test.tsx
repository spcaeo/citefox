// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setFetchIconsForTests } from '../siteIcon/loader'
import { announcedText, resetAnnouncerForTests } from './announce'
import { axeViolations } from './axe.test-helper'
import { urlTextHref } from './componentModels'
import { COPIED_MS, DomainText, UrlText } from './UrlText'

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())

beforeEach(() => {
  writeText.mockReset()
  writeText.mockImplementation(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  // No icons from main in these tests: letter tiles only.
  setFetchIconsForTests(() => Promise.resolve({ icons: [] }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setFetchIconsForTests(null)
  resetAnnouncerForTests()
})

function rootOf(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('.ui-url') as HTMLElement
}

describe('urlTextHref', () => {
  it('keeps a full URL and joins a path to its site', () => {
    expect(urlTextHref('https://textbolt.com/a')).toBe('https://textbolt.com/a')
    expect(urlTextHref('https://textbolt.com/a', 'other.com')).toBe('https://textbolt.com/a')
    expect(urlTextHref('/blog/post', 'textbolt.com')).toBe('https://textbolt.com/blog/post')
    expect(urlTextHref('/blog/post', 'https://textbolt.com/')).toBe(
      'https://textbolt.com/blog/post'
    )
    expect(urlTextHref('/blog/post', 'http://localhost:3000')).toBe(
      'http://localhost:3000/blog/post'
    )
    expect(urlTextHref('/blog/post')).toBe('/blog/post')
    expect(urlTextHref('/blog/post', null)).toBe('/blog/post')
  })
})

describe('UrlText: at rest', () => {
  it('shows the site icon and the address without https://www., nothing else', async () => {
    const view = render(<UrlText url="https://www.textbolt.com/email-to-sms/" />)
    const root = rootOf(view)
    expect(root.querySelector('[data-site-icon="textbolt.com"]')).toBeTruthy()
    expect(view.getByText('textbolt.com/email-to-sms/').getAttribute('title')).toBe(
      'https://www.textbolt.com/email-to-sms/'
    )
    expect(root.dataset.urlText).toBe('url')
    expect(root.className).toBe('ui-url ui-url-url')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('leaves the icon out on request, and for a path with no site', () => {
    const off = render(<UrlText url="https://textbolt.com/a" icon={false} />)
    expect(off.container.querySelector('.site-icon')).toBeNull()
    cleanup()
    const bare = render(<UrlText url="/a" />)
    expect(bare.container.querySelector('.site-icon')).toBeNull()
  })
})

describe('UrlText: hover and keyboard focus', () => {
  it('has named Copy and Open controls that use the full URL', async () => {
    const view = render(<UrlText url="https://textbolt.com/a" label="/a" />)
    const open = view.getByRole('link', { name: 'Open /a in a new tab' })
    expect(open.getAttribute('href')).toBe('https://textbolt.com/a')
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('rel')).toBe('noopener noreferrer')
    expect(view.getByRole('button', { name: 'Copy /a' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('puts the text, then Copy, then Open in the tab order', () => {
    const view = render(<UrlText url="https://textbolt.com/a" />)
    const focusable = [...view.container.querySelectorAll<HTMLElement>('[tabindex="0"], button, a')]
    expect(focusable.map((element) => element.className)).toEqual([
      'ui-url-value',
      'ui-url-btn ui-url-copy',
      'ui-url-btn ui-url-open'
    ])
  })

  it('copies on Enter and opens on ⌘ Enter or Ctrl Enter from the focused text', async () => {
    const outer = vi.fn()
    const view = render(
      // A row with its own keys (a grid row) never sees the Enter the text used.
      <div onKeyDown={outer}>
        <UrlText url="/pricing" site="textbolt.com" />
      </div>
    )
    const value = view.getByText('/pricing')
    const open = view.getByRole('link', { name: /^Open / })
    const opened = vi.fn((event: Event) => event.preventDefault())
    open.addEventListener('click', opened)
    await act(async () => {
      fireEvent.keyDown(value, { key: 'Enter' })
    })
    expect(writeText).toHaveBeenCalledWith('https://textbolt.com/pricing')
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(value, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(value, { key: 'Enter', ctrlKey: true })
    expect(opened).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(value, { key: 'a' })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('keeps a click on Copy or Open from reaching a clickable row', async () => {
    const row = vi.fn()
    const view = render(
      <div onClick={row}>
        <UrlText url="https://textbolt.com/a" />
      </div>
    )
    const open = view.getByRole('link', { name: /^Open / })
    open.addEventListener('click', (event) => event.preventDefault())
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^Copy / }))
    })
    fireEvent.click(open)
    expect(row).not.toHaveBeenCalled()
  })
})

describe('UrlText: copied', () => {
  it('turns Copy into a green tick for 1.5 s, says Copied, then hides the icons until the pointer leaves', async () => {
    vi.useFakeTimers()
    const view = render(<UrlText url="https://textbolt.com/a" label="/a" />)
    const root = rootOf(view)
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Copy /a' }))
    })
    expect(writeText).toHaveBeenCalledWith('https://textbolt.com/a')
    expect(view.getByRole('button', { name: 'Copied /a' })).toBeTruthy()
    expect(root.classList.contains('ui-url-copied')).toBe(true)
    expect(root.querySelector('.ui-url-copy path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5')
    expect(announcedText()).toBe('Copied')
    expect(document.querySelector('[data-announcer]')?.getAttribute('aria-live')).toBe('polite')
    act(() => {
      vi.advanceTimersByTime(COPIED_MS - 1)
    })
    expect(root.classList.contains('ui-url-copied')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(root.classList.contains('ui-url-copied')).toBe(false)
    expect(root.classList.contains('ui-url-done')).toBe(true)
    expect(view.getByRole('button', { name: 'Copy /a' })).toBeTruthy()
    fireEvent.mouseLeave(root)
    expect(root.classList.contains('ui-url-done')).toBe(false)
  })

  it('shows a cross and says so when the copy fails', async () => {
    vi.useFakeTimers()
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    document.execCommand = vi.fn(() => false)
    const view = render(<UrlText url="https://textbolt.com/a" label="/a" />)
    const root = rootOf(view)
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Copy /a' }))
    })
    expect(root.classList.contains('ui-url-failed')).toBe(true)
    expect(view.getByRole('button', { name: "Couldn't copy /a" })).toBeTruthy()
    expect(announcedText()).toContain("Couldn't copy")
    act(() => {
      vi.advanceTimersByTime(COPIED_MS)
    })
    expect(root.classList.contains('ui-url-failed')).toBe(false)
  })

  it('hides the icons after Open, until focus leaves', () => {
    const view = render(<UrlText url="https://textbolt.com/a" />)
    const root = rootOf(view)
    const open = view.getByRole('link', { name: /^Open / })
    open.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(open)
    expect(root.classList.contains('ui-url-done')).toBe(true)
    fireEvent.blur(view.getByRole('button', { name: /^Copy / }), { relatedTarget: document.body })
    expect(root.classList.contains('ui-url-done')).toBe(false)
  })
})

describe('UrlText: a path on a site', () => {
  it('shows the short path; Copy, Open and the tooltip use the full URL from siteBase', async () => {
    const view = render(<UrlText path="/pricing/" siteBase="textbolt.com" />)
    const root = rootOf(view)
    expect(root.dataset.urlText).toBe('path')
    expect(view.getByText('/pricing/').getAttribute('title')).toBe('https://textbolt.com/pricing/')
    expect(root.querySelector('[data-site-icon="textbolt.com"]')).toBeTruthy()
    expect(
      view.getByRole('link', { name: 'Open /pricing/ in a new tab' }).getAttribute('href')
    ).toBe('https://textbolt.com/pricing/')
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Copy /pricing/' }))
    })
    expect(writeText).toHaveBeenCalledWith('https://textbolt.com/pricing/')
  })

  it('opens a rival page on the rival site, and offers Copy only when there is no site', () => {
    const rival = render(<UrlText path="/blog/x" site="https://simpletexting.com" />)
    expect(rival.getByRole('link').getAttribute('href')).toBe('https://simpletexting.com/blog/x')
    cleanup()
    const bare = render(<UrlText url="/blog/x" />)
    expect(bare.queryByRole('link')).toBeNull()
    expect(bare.getByRole('button', { name: 'Copy /blog/x' })).toBeTruthy()
  })
})

describe('UrlText: long URL', () => {
  const long = 'https://simpletexting.com/blog/email-to-text-guide-for-teams/carriers-shut-down/'

  it('cuts in the middle of the path, never the domain; the tooltip and the copy are the full URL', async () => {
    const view = render(<UrlText url={long} />)
    const value = view.container.querySelector('.ui-url-value') as HTMLElement
    expect(value.querySelector('.ui-url-head')?.textContent).toBe('simpletexting.com')
    expect(value.querySelector('.ui-url-middle')?.textContent).toBe(
      '/blog/email-to-text-guide-for-teams'
    )
    expect(value.querySelector('.ui-url-tail')?.textContent).toBe('/carriers-shut-down/')
    // The end is cut from its start (an rtl box), its text kept left to right (audit2 #5).
    expect(value.querySelector('.ui-url-tail > bdi')?.textContent).toBe('/carriers-shut-down/')
    expect(value.textContent).toBe(long.replace('https://', ''))
    expect(value.getAttribute('title')).toBe(long)
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^Copy / }))
    })
    expect(writeText).toHaveBeenCalledWith(long)
  })

  it('keeps short labels and titles whole', () => {
    const view = render(
      <UrlText url={long} label="How carriers shut down email to text for small teams" />
    )
    expect(view.container.querySelector('.ui-url-middle')).toBeNull()
    cleanup()
    const short = render(<UrlText url="https://textbolt.com/a/b" />)
    expect(short.getByText('textbolt.com/a/b')).toBeTruthy()
  })
})

describe('UrlText: your site vs a rival', () => {
  it('keeps the highlighter on your site and the site kind on a rival', async () => {
    const view = render(
      <>
        <DomainText domain="textbolt.com" own kind="you" />
        <DomainText domain="twilio.com" kind="rival · vendor" />
      </>
    )
    const [own, rival] = [...view.container.querySelectorAll<HTMLElement>('.ui-url')]
    expect(own?.className).toContain('ui-url-own')
    expect(own?.className).toContain('ui-url-domain')
    expect(own?.querySelector('.ui-url-kind')?.textContent).toBe('you')
    expect(rival?.className).not.toContain('ui-url-own')
    expect(rival?.querySelector('.ui-url-kind')?.textContent).toBe('rival · vendor')
    expect(
      view.getByRole('link', { name: 'Open twilio.com in a new tab' }).getAttribute('href')
    ).toBe('https://twilio.com')
    expect(await axeViolations(view.container)).toEqual([])
  })
})

describe('UrlText: no icon found or offline', () => {
  it('shows a stable-colour letter tile, or a globe for a name with no domain', () => {
    const view = render(
      <>
        <UrlText domain="reddit.com/r/sysadmin" />
        <UrlText url="http://localhost:3000/a" />
      </>
    )
    const tile = view.container.querySelector('[data-site-icon="reddit.com"]')
    expect(tile?.getAttribute('data-letter')).toBe('R')
    expect(tile?.className).toMatch(/site-icon-tone-\d/)
    expect(view.container.querySelector('[data-site-icon="localhost"]')?.className).toContain(
      'site-icon-globe'
    )
  })
})

describe('UrlText: own content', () => {
  it('keeps an in-app link in place of the text, with the icon, Copy and Open beside it', () => {
    const view = render(
      <UrlText url="https://textbolt.com/blog/a" label="/blog/a">
        <a href="#/pages/page-1">/blog/a</a>
      </UrlText>
    )
    expect(view.getByRole('link', { name: '/blog/a' }).getAttribute('href')).toBe('#/pages/page-1')
    expect(view.getByRole('button', { name: 'Copy /blog/a' })).toBeTruthy()
    expect(view.getByRole('link', { name: 'Open /blog/a in a new tab' })).toBeTruthy()
    expect(view.container.querySelector('[data-site-icon="textbolt.com"]')).toBeTruthy()
    expect(view.container.querySelector('.ui-url-value')?.getAttribute('tabindex')).toBeNull()
  })
})

describe('UrlText: styles', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/src/ui/layout.css'), 'utf8')

  it('keeps Copy and Open shown on touch screens, which have no hover', () => {
    const touch = css.slice(css.indexOf('@media (hover: none)'))
    expect(touch).toMatch(
      /\.ui-url \.ui-url-actions,\s*\.ui-url\.ui-url-done \.ui-url-actions \{[^}]*opacity: 1/
    )
  })

  it('paints no fade that assumes the row is --surface', () => {
    const block = css.slice(css.indexOf('.ui-url {'))
    expect(block).not.toMatch(/linear-gradient/)
  })

  it('can show the text in the UI font', () => {
    const view = render(<UrlText url="https://textbolt.com" plain className="x" />)
    expect(rootOf(view).className).toBe('ui-url ui-url-url ui-url-plain x')
  })
})
