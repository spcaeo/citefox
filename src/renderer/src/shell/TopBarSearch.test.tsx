// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageSummary } from '@shared/domain'
import { axeViolations } from '../ui/axe.test-helper'
import type { SidebarTopic } from './sidebarTopics'
import { SEARCH_LABEL, matchTopics, plainQuestion, searchGroups } from './search'
import { TopBarSearch } from './TopBarSearch'
import type { QuestionMatches } from './useShellSearch'

const TOPICS: SidebarTopic[] = [
  { id: 't1', title: 'Carrier gateway replacement', goalPct: 40, href: '#/topics/t1' },
  { id: 't2', title: 'Text alerts for teams', goalPct: null, href: '#/topics/t2' }
]

const PAGES = [
  { id: 'p1', label: 'Gateway pricing', title: null, url: 'https://textbolt.com/pricing' }
] as unknown as PageSummary[]

const QUESTIONS: QuestionMatches = {
  hits: [
    {
      promptId: 'q1',
      sourceId: 'p1',
      sourceKind: 'page',
      sourceName: 'Gateway pricing',
      text: 'Which **email to SMS gateway** is cheapest?'
    },
    {
      promptId: 'q2',
      sourceId: 't1',
      sourceKind: 'topic',
      sourceName: 'Carrier gateway replacement',
      text: 'What replaces a carrier gateway?'
    }
  ],
  more: false,
  failed: false
}

function Harness({
  pages,
  questions
}: {
  pages: readonly PageSummary[] | null
  questions: QuestionMatches | null
}): JSX.Element {
  const [query, setQuery] = useState('')
  return (
    <>
      <button type="button">Elsewhere</button>
      <TopBarSearch
        foundPageCount={2014}
        query={query}
        onQuery={setQuery}
        pages={query ? pages : null}
        questions={query ? questions : null}
        topics={TOPICS}
      />
    </>
  )
}

function typed(
  value: string,
  pages: readonly PageSummary[] | null = PAGES,
  questions: QuestionMatches | null = QUESTIONS
): { view: ReturnType<typeof render>; box: HTMLInputElement } {
  const view = render(<Harness pages={pages} questions={questions} />)
  const box = view.getByRole('combobox', { name: SEARCH_LABEL }) as HTMLInputElement
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value } })
  return { view, box }
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('top bar search', () => {
  it('matches topics on every word, any case', () => {
    expect(matchTopics(TOPICS, 'GATEWAY carrier').map((topic) => topic.id)).toEqual(['t1'])
    expect(matchTopics(TOPICS, '  ')).toEqual([])
  })

  it('groups topics, pages and questions in that order, leaving out empty groups', () => {
    const groups = searchGroups({ topics: [], pages: PAGES, questions: QUESTIONS.hits })
    expect(groups.map((group) => group.heading)).toEqual(['Pages', 'Questions'])
    expect(groups[1]?.options).toEqual([
      {
        key: 'question:p1:q1',
        href: '#/pages/p1/prompt/q1',
        text: 'Which email to SMS gateway is cheapest?',
        detail: 'Page: Gateway pricing'
      },
      {
        key: 'question:t1:q2',
        href: '#/pages/t1/prompt/q2',
        text: 'What replaces a carrier gateway?',
        detail: 'Topic: Carrier gateway replacement'
      }
    ])
    expect(searchGroups({ topics: TOPICS, pages: null, questions: null })[0]?.id).toBe('topics')
    expect(plainQuestion('  **Bold** words ')).toBe('Bold words')
  })

  it('names the box, gives the page count as its tooltip, and focuses it on Cmd+K or Ctrl+K', () => {
    const view = render(<Harness pages={PAGES} questions={QUESTIONS} />)
    const box = view.getByRole('combobox', { name: SEARCH_LABEL })
    expect(box.getAttribute('aria-label')).toBe(
      'Find anything: screens, settings, reports, help, actions, pages, topics and questions'
    )
    // The box is 140 to 260 px wide: the placeholder is one short word, never cut mid-word.
    expect(box.getAttribute('placeholder')).toBe('Find anything…')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    expect(box.closest('label')?.getAttribute('title')).toBe(
      'Find screens, actions, 2,014 pages, topics and questions'
    )
    view.getByRole('button', { name: 'Elsewhere' }).focus()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.activeElement).toBe(box)
    box.blur()
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true })
    expect(document.activeElement).toBe(box)
  })

  it('lists topics, pages and questions as named groups of options, and Escape clears the box', async () => {
    const { view, box } = typed('gateway')
    expect(box.getAttribute('aria-expanded')).toBe('true')
    const listbox = view.getByRole('listbox', { name: 'Search results' })
    expect(box.getAttribute('aria-controls')).toBe(listbox.id)
    expect(
      within(listbox)
        .getAllByRole('group')
        .map((group) => group.textContent)
    ).toEqual([
      expect.stringMatching(/^TopicsCarrier gateway replacement$/),
      expect.stringMatching(/^PagesGateway pricing$/),
      expect.stringMatching(/^QuestionsWhich email to SMS gateway is cheapest\?Page: Gateway/)
    ])
    const topics = within(listbox).getByRole('group', { name: 'Topics' })
    expect(within(topics).getByRole('option').getAttribute('href')).toBe('#/topics/t1')
    const pages = within(listbox).getByRole('group', { name: 'Pages' })
    expect(
      within(pages)
        .getByRole('option', { name: /Gateway pricing/ })
        .getAttribute('href')
    ).toBe('#/pages/p1/results')
    const questions = within(listbox).getByRole('group', { name: 'Questions' })
    const question = within(questions).getByRole('option', { name: /email to SMS gateway/ })
    expect(question.getAttribute('href')).toBe('#/pages/p1/prompt/q1')
    expect(question.textContent).not.toContain('**')
    expect(
      within(questions)
        .getByRole('option', { name: /replaces a carrier gateway/ })
        .getAttribute('href')
    ).toBe('#/pages/t1/prompt/q2')
    expect(await axeViolations(view.container)).toEqual([])

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
    expect(view.queryByRole('listbox')).toBeNull()
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('walks every group with the arrow keys and opens the active option on Enter', () => {
    const { view, box } = typed('gateway')
    const active = (): string | null => {
      const id = box.getAttribute('aria-activedescendant')
      return id ? (document.getElementById(id)?.textContent ?? null) : null
    }
    expect(active()).toBeNull()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(active()).toBe('Carrier gateway replacement')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(active()).toBe('Gateway pricing')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(active()).toMatch(/^Which email to SMS gateway/)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(active()).toMatch(/^What replaces a carrier gateway/)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(active()).toBe('Carrier gateway replacement')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(active()).toMatch(/^What replaces a carrier gateway/)
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    const selected = view.getByRole('option', { selected: true })
    expect(selected.getAttribute('href')).toBe('#/pages/p1/prompt/q1')
    expect(view.getAllByRole('option', { selected: false })).toHaveLength(3)

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/p1/prompt/q1')
    expect(box.value).toBe('')
    expect(view.queryByRole('listbox')).toBeNull()
  })

  it('starts from the last option on ArrowUp, and typing drops the highlight', () => {
    const { box } = typed('gateway')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    const id = box.getAttribute('aria-activedescendant')
    expect(document.getElementById(id ?? '')?.getAttribute('href')).toBe('#/pages/t1/prompt/q2')
    fireEvent.change(box, { target: { value: 'gatewa' } })
    expect(box.getAttribute('aria-activedescendant')).toBeNull()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.hash).toBe('')
  })

  it('says it is searching until pages and questions arrive', () => {
    const { view } = typed('zzz', null, null)
    expect(view.getByRole('status').textContent).toBe('Searching pages and questions…')
    cleanup()
    const pagesOnly = typed('zzz', [], null)
    expect(pagesOnly.view.getByRole('status').textContent).toBe('Searching pages and questions…')
  })

  it('says when nothing matches, when the question search failed, and when more match', () => {
    const none = typed('zzz', [], { hits: [], more: false, failed: false })
    expect(none.view.getByText('Nothing matches. Try other words, or create it:')).toBeTruthy()
    expect(none.view.queryByRole('group', { name: 'Pages' })).toBeNull()
    cleanup()
    const failed = typed('gateway', PAGES, { hits: [], more: false, failed: true })
    expect(failed.view.getByText('Could not search questions.')).toBeTruthy()
    expect(failed.view.queryByRole('group', { name: 'Questions' })).toBeNull()
    cleanup()
    const more = typed('gateway', PAGES, { ...QUESTIONS, more: true })
    expect(
      more.view.getByText('Showing the first 2 questions. Type more words to narrow them.')
    ).toBeTruthy()
  })

  it('offers to create a topic or add questions when nothing matches, opening their drawers', async () => {
    const { view, box } = typed('weekend outages', [], { hits: [], more: false, failed: false })
    const create = view.getByRole('group', { name: 'Create' })
    expect(
      within(create)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Create topic “weekend outages”', 'Add questions: “weekend outages”'])
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.hash).toContain('drawer=new-topic')
    expect(box.value).toBe('')
    fireEvent.change(box, { target: { value: 'weekend outages' } })
    fireEvent.click(view.getByRole('option', { name: 'Add questions: “weekend outages”' }))
    expect(window.location.hash).toContain('drawer=add-questions')
  })

  it('offers to track a page when the text looks like an address or path', () => {
    const { view } = typed('/pricing-new', [], { hits: [], more: false, failed: false })
    fireEvent.click(view.getByRole('option', { name: 'Track page /pricing-new' }))
    expect(window.location.hash).toContain('drawer=track-page')
    // The typed address is not written to the URL (drawer values are opaque ids).
    expect(window.location.hash).not.toContain('pricing-new')
  })
})
