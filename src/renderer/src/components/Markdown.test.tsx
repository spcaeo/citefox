// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

afterEach(() => {
  cleanup()
})

describe('Markdown', () => {
  it('renders bold segments and leaves no asterisks', () => {
    const view = render(
      <Markdown>{'**5** AI Overviews shown, **2** page cited, and **Citation change:**'}</Markdown>
    )
    expect([...view.container.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
      '5',
      '2',
      'Citation change:'
    ])
    expect(view.container.textContent).toBe(
      '5 AI Overviews shown, 2 page cited, and Citation change:'
    )
    expect(view.container.textContent).not.toContain('**')
  })

  it('renders italic, inline code, and paragraphs', () => {
    const view = render(<Markdown>{'A *cited* page uses `score`.\n\nSecond paragraph.'}</Markdown>)
    expect(view.container.querySelector('em')?.textContent).toBe('cited')
    expect(view.container.querySelector('code')?.textContent).toBe('score')
    expect(view.container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders lists', () => {
    const view = render(<Markdown>{'- one\n- two'}</Markdown>)
    expect([...view.container.querySelectorAll('li')].map((node) => node.textContent)).toEqual([
      'one',
      'two'
    ])
    expect(view.container.querySelector('ul')).toBeTruthy()
  })

  it('maps headings from the base level and does not assume h1', () => {
    const shifted = render(<Markdown baseLevel={3}>{'# Title\n\n## Sub'}</Markdown>)
    expect(shifted.getByRole('heading', { level: 3, name: 'Title' })).toBeTruthy()
    expect(shifted.getByRole('heading', { level: 4, name: 'Sub' })).toBeTruthy()
    expect(shifted.container.querySelector('h1')).toBeNull()
    cleanup()
    const fallback = render(<Markdown>{'# Section'}</Markdown>)
    expect(fallback.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy()
    expect(fallback.container.querySelector('h1')).toBeNull()
  })

  it('allows http and https links and keeps them from navigating this window', () => {
    const view = render(
      <Markdown>
        {'[Docs](https://citefox.example/docs) and [Plain](http://citefox.example/a)'}
      </Markdown>
    )
    const links = view.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://citefox.example/docs',
      'http://citefox.example/a'
    ])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.querySelector('.sr-only')?.textContent).toBe(' (opens in your browser)')
    }
  })

  it('autolinks a bare https url', () => {
    const view = render(<Markdown>{'See https://citefox.example/docs'}</Markdown>)
    const link = view.getByRole('link', {
      name: 'https://citefox.example/docs (opens in your browser)'
    })
    expect(link.getAttribute('href')).toBe('https://citefox.example/docs')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.querySelector('.sr-only')?.textContent).toBe(' (opens in your browser)')
  })

  it('drops javascript, data, and vbscript urls', () => {
    const view = render(
      <Markdown>
        {
          '[js](javascript:alert(1)) [data](data:text/html,hi) [vb](vbscript:msgbox(1)) [ok](https://citefox.example/ok)'
        }
      </Markdown>
    )
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(view.getByRole('link').getAttribute('href')).toBe('https://citefox.example/ok')
    expect(view.container.textContent).toContain('js')
    expect(view.container.textContent).toContain('data')
    expect(view.container.textContent).toContain('vb')
    const html = view.container.innerHTML.toLowerCase()
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:')
    expect(html).not.toContain('vbscript:')
  })

  it('renders an html-like string as escaped text', () => {
    const view = render(<Markdown>{'See <em>not italic</em> here'}</Markdown>)
    expect(view.container.querySelector('em')).toBeNull()
    expect(view.container.textContent).toContain('<em>not italic</em>')
    expect(view.container.innerHTML).not.toContain('<em>')
  })

  it('does not create a script element from a script tag', () => {
    const view = render(<Markdown>{'before <script>alert(1)</script> after'}</Markdown>)
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.innerHTML.toLowerCase()).not.toContain('<script')
    expect(view.container.textContent).toContain('<script>alert(1)</script>')
  })

  it('shows image alt text and never an img element for a remote source', () => {
    const view = render(
      <Markdown>
        {'![remote](https://example.com/a.png)\n\n![](https://example.com/b.png)'}
      </Markdown>
    )
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('remote')
    expect(view.container.innerHTML).not.toContain('example.com/a.png')
    expect(view.container.innerHTML).not.toContain('example.com/b.png')
    expect(view.container.innerHTML).not.toContain('<img')
  })

  it('does not load an html image', () => {
    const view = render(<Markdown>{'<img src="https://example.com/a.png" alt="remote">'}</Markdown>)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.innerHTML.toLowerCase()).not.toContain('<img')
  })

  it('unwraps tables, rules, and task lists in inline mode', () => {
    const view = render(
      <Markdown inline>{'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n\n- [ ] x'}</Markdown>
    )
    const root = view.container.querySelector('.md')
    expect(root?.tagName).toBe('SPAN')
    expect(
      root?.querySelector(
        'table, thead, tbody, tfoot, tr, th, td, hr, input, p, div, ul, ol, li, pre, blockquote, h1, h2, h3, h4, h5, h6, button, textarea, select'
      )
    ).toBeNull()
    expect(view.container.textContent).toContain('a')
    expect(view.container.textContent).toContain('b')
    expect(view.container.textContent).toContain('1')
    expect(view.container.textContent).toContain('2')
    expect(view.container.textContent).toContain('x')
  })

  it('keeps image alt text in inline mode and does not emit an img', () => {
    const view = render(
      <Markdown inline>
        {'![remote](https://example.com/a.png) ![](https://example.com/b.png)'}
      </Markdown>
    )
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('remote')
    expect(view.container.innerHTML).not.toContain('example.com')
    expect(view.container.innerHTML).not.toContain('<img')
  })

  it('renders nothing for empty input', () => {
    const view = render(<Markdown>{''}</Markdown>)
    expect(view.container.querySelector('.md')).toBeNull()
    expect(view.container.textContent).toBe('')
    cleanup()
    const blank = render(<Markdown>{'   \n'}</Markdown>)
    expect(blank.container.querySelector('.md')).toBeNull()
  })
})
