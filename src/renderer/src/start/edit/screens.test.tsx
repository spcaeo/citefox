// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SiteStartPage,
  SiteStartPlan,
  StartEdit,
  StartEditResult,
  StartKnown,
  StartProgress
} from '@shared/ipc'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetActivityFeed } from '../activity'
import { fakeStartClient } from '../fakeStartClient.test-helper'
import { PlanScreen } from '../PlanScreen'
import { SetupKnown } from '../SetupKnown'

afterEach(cleanup)
beforeEach(() => resetActivityFeed())

const PROJECT = { id: 'p1', name: 'TextBolt', domain: 'textbolt.com' }

function known(patch: Partial<StartKnown> = {}): StartKnown {
  return {
    pageCount: 142,
    sections: [{ key: '/blog/', label: 'Blog', pageCount: 58 }],
    rivals: [
      { name: 'SimpleTexting', domain: null, kind: 'competitor', reason: '' },
      { name: 'PagerDuty', domain: null, kind: 'competitor', reason: '' }
    ],
    buyers: { who: 'Office managers', segments: ['Clinics'], triggers: ['Gateway stopped'] },
    picked: 2,
    pickedPages: [
      { url: 'https://textbolt.com/pricing/', path: '/pricing/' },
      {
        url: 'https://textbolt.com/compare/textbolt-vs-twilio/',
        path: '/compare/textbolt-vs-twilio/'
      }
    ],
    questions: [{ id: 'q1', text: 'How do I text my staff?', stage: 'problem', targetUrl: null }],
    upNext: [],
    ...patch
  }
}

function progress(knownPatch: Partial<StartKnown> = {}): StartProgress {
  return {
    projectId: 'p1',
    phase: 'running',
    items: [],
    startedAt: '2026-10-22T10:00:00.000Z',
    elapsedMs: 10_000,
    etaSeconds: 40,
    message: null,
    known: known(knownPatch)
  }
}

function result(
  summary: string,
  patch: { plan?: SiteStartPlan | null; progress?: StartProgress | null } = {}
): StartEditResult {
  return {
    record: {
      id: `e-${summary}`,
      edit: { kind: 'rival', op: 'remove', name: 'x' },
      summary,
      at: '2026-10-22T10:00:00.000Z',
      undoneAt: null,
      parentId: null,
      system: false
    },
    effect: null,
    plan: patch.plan ?? null,
    progress: patch.progress ?? null
  }
}

function Live({ client }: { client: ReturnType<typeof fakeStartClient> }): JSX.Element {
  const [current, setCurrent] = useState<StartProgress>(progress())
  return <SetupKnown progress={current} client={client} project={PROJECT} onProgress={setCurrent} />
}

describe('SetupKnown while the autopilot runs', () => {
  it('removes a competitor, drops a page and edits a question, showing what comes back', async () => {
    const sent: StartEdit[] = []
    const client = fakeStartClient({
      overrides: {
        edit: ({ edit }) => {
          sent.push(edit)
          if (edit.kind === 'rival') {
            return Promise.resolve(
              result('Removed competitor PagerDuty', {
                progress: progress({
                  rivals: [{ name: 'SimpleTexting', domain: null, kind: 'competitor', reason: '' }]
                })
              })
            )
          }
          if (edit.kind === 'page') {
            return Promise.resolve(
              result('Took /compare/textbolt-vs-twilio/ off the picked pages', {
                progress: progress({
                  rivals: [{ name: 'SimpleTexting', domain: null, kind: 'competitor', reason: '' }],
                  picked: 1,
                  pickedPages: [{ url: 'https://textbolt.com/pricing/', path: '/pricing/' }]
                })
              })
            )
          }
          return Promise.resolve(result('Edited question Q1'))
        }
      }
    })
    const view = render(<Live client={client} />)
    expect(await axeViolations(view.container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Edit competitor PagerDuty' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit competitor PagerDuty' })).toBeNull()
    )
    expect((await screen.findByRole('status')).textContent).toContain(
      'Removed competitor PagerDuty'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit page: /compare/textbolt-vs-twilio/' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('/compare/textbolt-vs-twilio/')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Edit question: How do I text my staff?' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit question' })
    fireEvent.change(box, { target: { value: 'How do I text my whole crew?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(sent).toHaveLength(3))
    expect(sent).toEqual([
      { kind: 'rival', op: 'remove', name: 'PagerDuty' },
      { kind: 'page', op: 'remove', url: 'https://textbolt.com/compare/textbolt-vs-twilio/' },
      { kind: 'question', op: 'edit', id: 'q1', text: 'How do I text my whole crew?' }
    ])
  })

  it('adds a picked page from a typed path', async () => {
    const edit = vi.fn(() => Promise.resolve(result('Added /features to the picked pages')))
    const client = fakeStartClient({ overrides: { edit } })
    render(<Live client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a page' }))
    fireEvent.change(screen.getByLabelText('Page to add'), { target: { value: '/features' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        projectId: 'p1',
        edit: { kind: 'page', op: 'add', url: 'https://textbolt.com/features' }
      })
    )
  })
})

function page(path: string, patch: Partial<SiteStartPage> = {}): SiteStartPage {
  return {
    url: `https://textbolt.com${path}`,
    path,
    title: null,
    pageId: null,
    kind: 'other',
    section: 'Top-level pages',
    reason: 'Buyers ask about it',
    evidence: 'Sitemap',
    alreadyTracked: false,
    questionCount: 0,
    ...patch
  }
}

function plan(patch: Partial<SiteStartPlan> = {}): SiteStartPlan {
  return {
    projectId: 'p1',
    domain: 'textbolt.com',
    pageCount: 142,
    sitemapCount: 1,
    sitemapProblem: null,
    sections: [],
    pagesRead: [],
    retried: 0,
    skipped: 0,
    pages: [page('/pricing/'), page('/compare/textbolt-vs-twilio/')],
    recommendedUrls: ['https://textbolt.com/pricing/'],
    topics: [],
    rivals: [],
    buyers: { who: null, segments: [], triggers: [] },
    topic: {
      draftId: 'd1',
      name: 'Text alerts for teams',
      seed: 'Text alerts for teams',
      questionCount: 3,
      stageCount: 2
    },
    questions: [
      { id: 'q1', text: 'How do I text my staff?', stage: 'problem', targetUrl: null },
      { id: 'q2', text: 'Is email to text reliable?', stage: 'doubts', targetUrl: null },
      { id: 'q3', text: 'What does it cost?', stage: 'decide', targetUrl: null }
    ],
    source: 'claude',
    message: null,
    label: null,
    budget: { markets: 1, promptsPerPage: 10, questionsPerTopic: 3, samples: 1, searchesLeft: 200 },
    elapsedMs: 60_000,
    builtAt: '2026-10-22T10:00:00.000Z',
    topicId: null,
    firstCheckAt: null,
    ...patch
  }
}

describe('PlanScreen editing', () => {
  it('adds a page and ticks it, and edits a question', async () => {
    window.location.hash = '#/start/plan'
    const sent: StartEdit[] = []
    const base = plan()
    const client = fakeStartClient({
      plan: base,
      overrides: {
        edit: ({ edit }) => {
          sent.push(edit)
          if (edit.kind === 'page') {
            return Promise.resolve(
              result('Added /features', {
                plan: plan({ pages: [...base.pages, page('/features')] })
              })
            )
          }
          return Promise.resolve(
            result('Edited question Q2', {
              plan: plan({
                questions: base.questions.map((question) =>
                  question.id === 'q2'
                    ? { ...question, text: 'Can staff reply by text?' }
                    : question
                )
              })
            })
          )
        }
      }
    })
    render(<PlanScreen client={client} project={PROJECT} />)
    expect(await screen.findByRole('checkbox', { name: 'Target /pricing/' })).toHaveProperty(
      'checked',
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add a page' }))
    fireEvent.change(screen.getByLabelText('Page to add'), { target: { value: '/features' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const added = await screen.findByRole('checkbox', { name: 'Target /features' })
    await waitFor(() => expect(added).toHaveProperty('checked', true))
    expect(window.location.hash).toBe('#/start/plan?t=0.2')

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit question: Is email to text reliable?' })
    )
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit question' })
    fireEvent.change(box, { target: { value: 'Can staff reply by text?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Can staff reply by text?')).toBeTruthy()
    expect(sent).toEqual([
      { kind: 'page', op: 'add', url: 'https://textbolt.com/features' },
      { kind: 'question', op: 'edit', id: 'q2', text: 'Can staff reply by text?' }
    ])
  })
})
