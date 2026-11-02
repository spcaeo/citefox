// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlaygroundAioResult } from '@shared/ipc'
import { DrillHost } from '../drill'
import { pageHash, readHash } from '../shell/routes'
import { SaveNoteText } from './components/SaveNote'
import { firstOpenablePart, savedPartHref } from './saveNote'
import { AioPanel, CoverageMatrix } from './OutputPanels'
import { parseCoverageMatrix } from './output'

afterEach(cleanup)

const PAGE = 'https://example.com/blog/texting/'

const AIO: PlaygroundAioResult = {
  url: PAGE,
  runId: 'run-1',
  prompts: [
    {
      prompt: 'best business texting app',
      ok: true,
      keyId: 'k1',
      keyLabel: 'Main',
      reason: null,
      message: null,
      cited: true,
      position: 2,
      summary: 'Texting apps let teams…',
      citedSources: [
        { url: 'https://other.example/a', domain: 'other.example', position: 1 },
        { url: PAGE, domain: 'example.com', position: 2 }
      ]
    },
    {
      prompt: 'text from landline',
      ok: true,
      keyId: 'k1',
      keyLabel: 'Main',
      reason: null,
      message: null,
      cited: false,
      position: null,
      summary: null,
      citedSources: [{ url: 'https://third.example/', domain: 'third.example', position: 1 }]
    },
    {
      prompt: 'sms for clinics',
      ok: false,
      keyId: null,
      keyLabel: null,
      reason: 'rate_limited',
      message: 'SerpApi is rate limiting this key.',
      cited: null,
      position: null,
      summary: null,
      citedSources: []
    }
  ]
}

const MATRIX = [
  '#\tPrompt\tCoverage\tWhere covered now\tMain gap\tAction',
  '1\tbest texting app\tStrong\tH2 Pricing\tNone\tKeep',
  '2\ttext from landline\tWeak\tFAQ\tNo setup steps\tAdd steps',
  '3\tsms for clinics\tWeak\tNowhere\tNo clinic example\tAdd a case',
  '',
  'Page-wide findings',
  '- Add a comparison table'
].join('\n')

function drawerRows(): number {
  return screen.getByRole('dialog').querySelectorAll('[data-drill-row]').length
}

describe('Playground drill-downs', () => {
  it('coverage counts open exactly the rows at that level, and rows expand to the detail', () => {
    const view = parseCoverageMatrix(MATRIX)
    if (!view) throw new Error('matrix did not parse')
    render(
      <DrillHost>
        <CoverageMatrix view={view} />
      </DrillHost>
    )
    const weak = screen.getByRole('button', { name: '2 questions with Weak coverage' })
    expect(weak.querySelector('[data-nfr-figure]')?.textContent).toBe('2')
    fireEvent.click(weak)
    expect(drawerRows()).toBe(2)
    expect(within(screen.getByRole('dialog')).getByRole('heading', { level: 2 }).textContent).toBe(
      'Weak coverage · 2 questions'
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '3 questions in the coverage matrix' }))
    expect(drawerRows()).toBe(3)
  })

  it('the cited count opens those questions; position jumps to the page; sources open externally', () => {
    render(
      <DrillHost>
        <AioPanel result={AIO} pageUrl={PAGE} />
      </DrillHost>
    )
    const cited = screen.getByRole('button', { name: 'Page cited in 1 question' })
    fireEvent.click(cited)
    expect(drawerRows()).toBe(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '3 AI Overviews checked' }))
    expect(drawerRows()).toBe(3)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    const position = screen.getByRole('button', {
      name: 'Position 2: show the page in the sources'
    })
    fireEvent.click(position)
    expect(document.activeElement?.textContent).toContain('This page')

    const source = screen.getByRole('link', { name: /^other\.example/ })
    expect(source.getAttribute('href')).toBe('https://other.example/a')
    expect(source.getAttribute('target')).toBe('_blank')
  })

  it('the save note links to the saved page in the open project', () => {
    render(
      <SaveNoteText
        note={{
          text: 'Saved Questions to TextBolt.',
          after: 'Anything you did not pick is still not saved.',
          pageId: 'page-9',
          part: 'prompts',
          inOpenProject: true,
          projectName: 'TextBolt'
        }}
      />
    )
    const link = screen.getByRole('link', { name: 'Open the saved page' })
    expect(link.getAttribute('href')).toBe(pageHash('page-9', 'prompts'))
    expect(screen.getByRole('status').textContent).not.toContain('Page page-9')
    cleanup()
    render(
      <SaveNoteText
        note={{
          text: 'Saved Page read to Other.',
          after: '',
          pageId: 'page-9',
          part: 'pageRead',
          inOpenProject: false,
          projectName: 'Other'
        }}
      />
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Open Other to see the saved page.')
    expect(savedPartHref('page-9', 'pageRead')).toBe(readHash('page-9'))
    expect(firstOpenablePart(['pageRead', 'coverage'])).toBe('coverage')
  })
})
