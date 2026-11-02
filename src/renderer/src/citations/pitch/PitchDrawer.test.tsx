// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CitedPageRow,
  CitedPagesData,
  HelpFillDescribeRequest,
  HelpFillPromptRequest,
  HelpFillResult
} from '@shared/ipc'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetDrawersForTests, useDrawerEntry } from '../../shell/drawers'
import type { HelpFillSource } from '../../ui'
import type { CitationsSource } from '../source'
import { PitchDrawer } from './PitchDrawer'

const PITCH = 'Subject: A page for your SMS guide\n\nHi,\n\nYour guide names SimpleTexting.'

function row(patch: Partial<CitedPageRow> & Pick<CitedPageRow, 'id' | 'domain'>): CitedPageRow {
  return {
    url: `https://www.${patch.domain}/guide/`,
    title: null,
    domainId: `d-${patch.domain}`,
    whose: 'other',
    competitor: null,
    marketIds: ['mkt-us'],
    questions: [],
    overviews: [],
    ...patch
  }
}

const QUESTION = {
  id: 'page-1|prompt-2',
  pageId: 'page-1',
  pageKind: 'page' as const,
  pageLabel: 'Pricing',
  promptId: 'prompt-2',
  promptLabel: 'Q2',
  promptText: 'Which plan covers scheduled texts?',
  marketId: 'mkt-us',
  runId: 'run-us',
  marketIds: ['mkt-us'],
  position: 3
}
const OVERVIEW = {
  id: 'run-us|prompt-2',
  questionId: 'page-1|prompt-2',
  marketId: 'mkt-us',
  runId: 'run-us',
  position: 3
}

const DATA: CitedPagesData = {
  projectId: 'proj-1',
  ownDomain: 'textbolt.com',
  checks: 1,
  questions: 1,
  checkedAt: '2026-10-19T12:00:00.000Z',
  rows: [
    row({
      id: 'scomp',
      domain: 'simpletexting.com',
      whose: 'competitor',
      competitor: 'SimpleTexting',
      questions: [QUESTION],
      overviews: [{ ...OVERVIEW, position: 1 }]
    }),
    row({
      id: 'sg2b',
      domain: 'g2.com',
      title: 'Best SMS software',
      questions: [QUESTION],
      overviews: [OVERVIEW]
    })
  ]
}

function textResult(text: string): HelpFillResult {
  return {
    kind: 'pitch',
    rows: [{ id: 'r0', section: null, values: { text } }],
    setAside: [],
    counts: { read: 1, tracked: 0, repeats: 0, setAside: 0, ready: 1 },
    noun: ['pitch', 'pitches'],
    brand: 'TextBolt',
    warnings: [],
    text
  }
}

function fakeHelp(): HelpFillSource & {
  prompts: HelpFillPromptRequest[]
  describes: HelpFillDescribeRequest[]
} {
  const prompts: HelpFillPromptRequest[] = []
  const describes: HelpFillDescribeRequest[] = []
  return {
    prompts,
    describes,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: true,
      calls: 1,
      costText: '1 AI call · about $0.01',
      reason: null
    }),
    'helpfill:prompt': async (request) => {
      prompts.push(request)
      return { kind: 'pitch', prompt: 'Write a pitch email.', columns: [], tracked: 0 }
    },
    'helpfill:read': async ({ text }) => textResult(text),
    'helpfill:describe': async (request) => {
      describes.push(request)
      return textResult(PITCH)
    }
  }
}

const cited: CitationsSource = {
  'fixes:searches': () => Promise.reject(new Error('not used')),
  'allpages:citedPages': () => Promise.resolve(DATA),
  'competitors:save': () => Promise.reject(new Error('not used')),
  'competitors:restore': () => Promise.reject(new Error('not used'))
}

function Harness({ help }: { help: HelpFillSource }): JSX.Element | null {
  const api = useDrawerEntry('pitch')
  return api ? (
    <PitchDrawer
      projectId="proj-1"
      entry={api.entry}
      depth={api.depth}
      source={cited}
      helpSource={help}
    />
  ) : null
}

const writeText = vi.fn(async () => undefined)

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
  window.location.hash = ''
})

const OPEN = '#/citations?drawer=pitch&pitch.row=sg2b&pitch.page=page-1&pitch.prompt=prompt-2'

describe('PitchDrawer', () => {
  it('shows the facts and drafts the pitch for review, with Copy; nothing is sent', async () => {
    window.location.hash = OPEN
    const help = fakeHelp()
    const view = render(<Harness help={help} />)
    const drawer = await view.findByRole('dialog', { name: 'Draft a pitch' })
    expect(drawer.textContent).toContain('CiteFox never sends it')
    const facts = view.getByTestId('pitch-facts')
    expect(within(facts).getByText('Which plan covers scheduled texts?')).toBeTruthy()
    expect(within(facts).getByText('Pricing')).toBeTruthy()
    // Every URL and domain shown has Copy and Open.
    expect(within(facts).getByRole('button', { name: /Copy g2\.com/u })).toBeTruthy()
    expect(within(facts).getByRole('button', { name: /Copy simpletexting\.com/u })).toBeTruthy()
    // No green primary: the footer is Close only.
    expect(drawer.querySelector('.ui-btn-primary')).toBeNull()
    fireEvent.click(await view.findByRole('button', { name: 'Draft the pitch' }))
    await waitFor(() => expect(view.getByTestId('pitch-draft').textContent).toContain('Subject'))
    expect(help.describes[0]?.scope).toEqual({
      pageId: 'page-1',
      promptId: 'prompt-2',
      subject: 'sg2b'
    })
    fireEvent.click(view.getByRole('button', { name: 'Copy pitch email' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PITCH))
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('writes it with my ChatGPT: way and bot on the URL, the pasted email shows with Copy', async () => {
    window.location.hash = OPEN
    const help = fakeHelp()
    const view = render(<Harness help={help} />)
    fireEvent.click(await view.findByRole('radio', { name: /Write it with my ChatGPT/u }))
    await waitFor(() => expect(window.location.hash).toContain('pitch.help=chatbot'))
    await waitFor(() => expect(help.prompts[0]?.scope.subject).toBe('sg2b'))
    fireEvent.change(view.getByLabelText('Paste its answer below'), {
      target: { value: 'Subject: Hello\n\nHi, a quick idea.' }
    })
    fireEvent.click(view.getByRole('button', { name: 'Read the answer' }))
    await waitFor(() =>
      expect(view.getByTestId('pitch-draft').textContent).toContain('Hi, a quick idea.')
    )
  })

  it('a link to a page no longer cited says so', async () => {
    window.location.hash =
      '#/citations?drawer=pitch&pitch.row=sgone&pitch.page=page-1&pitch.prompt=prompt-2'
    const view = render(<Harness help={fakeHelp()} />)
    expect(
      await view.findByText(
        'That cited page is not in the latest checks any more, or is not available to you.'
      )
    ).toBeTruthy()
  })
})
