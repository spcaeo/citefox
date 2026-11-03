// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { LoggedFix, Market, PromptSetView } from '@shared/domain'
import type {
  CreateFixRequest,
  FixIdRequest,
  ProjectFixList,
  QuestionTargets,
  HelpFillPromptRequest,
  UpdateFixRequest
} from '@shared/ipc'
import { fix as makeFix } from '../../progress/fixtures'
import { resetDrawersForTests, useDrawerEntry } from '../../shell/drawers'
import type { HelpFillSource } from '../../ui'
import { UndoToastHost } from '../../ui/UndoToast'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { FixDrawer } from './FixDrawer'
import type { FixDrawerSource } from './source'

const NOW = new Date('2026-10-20T12:00:00.000Z')
const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

const planned: LoggedFix = makeFix({
  id: 'fix-2',
  number: 2,
  description: 'Add a price table',
  status: 'planned',
  followUpAt: '2026-10-24T12:00:00.000Z',
  followUpJobId: null,
  followUpRunId: null,
  promptIds: ['p1'],
  marketIds: ['mkt-us']
})

const done: LoggedFix = makeFix({
  id: 'fix-1',
  number: 1,
  description: 'Added 5 FAQs',
  status: 'completed',
  followUpJobId: 'job-0',
  followUpRunId: 'run-0',
  promptIds: ['p1'],
  marketIds: ['mkt-us']
})

const LIST: ProjectFixList = {
  projectId: 'proj-1',
  markets: [US],
  subjects: [
    { id: 'page-1', kind: 'page', label: 'Pricing', url: 'https://textbolt.com/pricing/' }
  ],
  fixes: [
    { fix: planned, searchesMin: 1, searchesMax: 2 },
    { fix: done, searchesMin: 1, searchesMax: 2 }
  ],
  suggestions: [
    {
      id: 'row-1',
      pageId: 'page-1',
      promptId: 'p2',
      promptLabel: 'Q2',
      promptText: 'Does it work with Outlook rules?',
      coverage: 'weak',
      priority: 'high',
      actions: ['new_faq'],
      whatToUpdate: 'Add an Outlook rules FAQ.',
      mainGap: 'No Outlook answer.'
    }
  ]
}

const TARGETS = {
  projectId: 'proj-1',
  markets: [US],
  searchesLeft: null,
  targets: [
    {
      id: 'page-1',
      kind: 'page',
      name: 'Pricing',
      url: 'https://textbolt.com/pricing/',
      status: 'tracked',
      questions: 2,
      keywords: 0,
      samples: 1,
      marketIds: ['mkt-us'],
      nextCheckAt: null
    }
  ]
} as unknown as QuestionTargets

const PROMPTS = {
  pageId: 'page-1',
  prompts: [1, 2].map((n) => ({
    id: `p${n}`,
    position: n,
    label: `Q${n}`,
    enabled: true,
    variants: [{ marketId: 'mkt-us', text: `Question ${n}?` }]
  }))
} as unknown as PromptSetView

interface Calls {
  creates: CreateFixRequest[]
  updates: UpdateFixRequest[]
  deletes: FixIdRequest[]
  restores: FixIdRequest[]
  runs: FixIdRequest[]
  loads: number
}

function fakeSource(): { source: FixDrawerSource; calls: Calls } {
  const calls: Calls = { creates: [], updates: [], deletes: [], restores: [], runs: [], loads: 0 }
  const source: FixDrawerSource = {
    'fixes:listProject': () => {
      calls.loads += 1
      return Promise.resolve(LIST)
    },
    'fixes:preview': () =>
      Promise.resolve({
        nextFixNumber: 3,
        followUpAt: {
          after_3_days: '2026-10-23T00:00:00.000Z',
          after_7_days: '2026-10-27T00:00:00.000Z',
          next_scheduled: null
        },
        samples: 1,
        searchesMin: 1,
        searchesMax: 2
      } as never),
    'fixes:create': (request) => {
      calls.creates.push(request)
      return Promise.resolve({ ...planned, id: 'fix-3', number: 3 })
    },
    'fixes:update': (request) => {
      calls.updates.push(request)
      return Promise.resolve(planned)
    },
    'fixes:delete': (request) => {
      calls.deletes.push(request)
      return Promise.resolve({ pageId: 'page-1', fixes: [], nextFixNumber: 3 })
    },
    'fixes:restore': (request) => {
      calls.restores.push(request)
      return Promise.resolve(planned)
    },
    'fixes:runFollowUp': (request) => {
      calls.runs.push(request)
      return Promise.resolve({ fix: { ...planned, status: 'started' }, jobId: 'job-1' })
    },
    'prompts:addTargets': () => Promise.resolve(TARGETS),
    'prompts:list': () => Promise.resolve(PROMPTS)
  }
  return { source, calls }
}

function fakeHelp(): HelpFillSource & { prompts: HelpFillPromptRequest[] } {
  const prompts: HelpFillPromptRequest[] = []
  return {
    prompts,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: true,
      calls: 1,
      costText: '1 AI call · about $0.02',
      reason: null
    }),
    'helpfill:prompt': async (request) => {
      prompts.push(request)
      return { kind: 'fix', prompt: 'Rewrite my section.', columns: [], tracked: 0 }
    },
    'helpfill:read': async ({ text }) => ({
      kind: 'fix',
      rows: [{ id: 'r0', section: null, values: { text } }],
      setAside: [],
      counts: { read: 1, tracked: 0, repeats: 0, setAside: 0, ready: 1 },
      noun: ['section', 'sections'],
      brand: 'TextBolt',
      warnings: [],
      text
    }),
    'helpfill:describe': async () => {
      throw new Error('not used')
    }
  }
}

function Harness({
  source,
  helpSource
}: {
  source: FixDrawerSource
  helpSource?: HelpFillSource
}): JSX.Element {
  const api = useDrawerEntry('fix')
  return (
    <>
      {api ? (
        <FixDrawer
          projectId="proj-1"
          entry={api.entry}
          depth={api.depth}
          source={source}
          {...(helpSource ? { helpSource } : {})}
          now={NOW}
        />
      ) : null}
      <UndoToastHost />
    </>
  )
}

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  resetDrawersForTests()
  window.location.hash = ''
})

describe('FixDrawer', () => {
  it('logs a fix prefilled from the URL, with its cost, and Undo deletes it', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=new&fix.page=page-1&fix.prompts=p1'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const first = await view.findByRole('checkbox', { name: /Question 1\?/ })
    expect((first as HTMLInputElement).checked).toBe(true)
    const drawer = view.getByRole('dialog', { name: 'Log a fix' })
    expect(await within(drawer).findByText(/The follow-up uses 1–2 searches/)).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Log fix' }))
    expect(await within(drawer).findByText('Describe what you changed first.')).toBeTruthy()
    fireEvent.change(within(drawer).getByLabelText('What changed'), {
      target: { value: 'Added a per-message price table.' }
    })
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /Question 2\?/ }))
    await waitFor(() => expect(window.location.hash).toContain('fix.prompts=p1%2Cp2'))
    const kind = within(drawer).getByLabelText('Kind of change') as HTMLSelectElement
    expect(kind.value).toBe('fix')
    fireEvent.change(kind, { target: { value: 'rewrite' } })
    await waitFor(() => expect(window.location.hash).toContain('fix.kind=rewrite'))
    fireEvent.change(within(drawer).getByLabelText('Goes live on'), {
      target: { value: '2026-10-21' }
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Log fix' }))
    await waitFor(() => expect(calls.creates).toHaveLength(1))
    expect(calls.creates[0]).toMatchObject({
      projectId: 'proj-1',
      pageId: 'page-1',
      description: 'Added a per-message price table.',
      kind: 'rewrite',
      goLiveAt: new Date('2026-10-21T00:00:00').toISOString(),
      rule: 'after_3_days',
      promptIds: ['p1', 'p2'],
      marketIds: ['mkt-us']
    })
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('Logged Fix 3.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.deletes).toEqual([{ projectId: 'proj-1', fixId: 'fix-3' }]))
  })

  it('takes the description and question from a content-gap suggestion', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=new&fix.page=page-1&fix.from=row-1'
    const { source } = fakeSource()
    const view = render(<Harness source={source} />)
    const second = await view.findByRole('checkbox', { name: /Question 2\?/ })
    expect((second as HTMLInputElement).checked).toBe(true)
    expect((view.getByLabelText('What changed') as HTMLTextAreaElement).value).toBe(
      'Add an Outlook rules FAQ.\n\nNo Outlook answer.'
    )
  })

  it('"Is this a fix?" on Pages starts with every question of the page ticked', async () => {
    window.location.hash =
      '#/pages?drawer=fix&fix=new&fix.page=page-1&fix.from=page-change&fix.text=2+sections+are+new.'
    const { source } = fakeSource()
    const view = render(<Harness source={source} />)
    const first = await view.findByRole('checkbox', { name: /Question 1\?/ })
    await waitFor(() => expect((first as HTMLInputElement).checked).toBe(true))
    const second = view.getByRole('checkbox', { name: /Question 2\?/ }) as HTMLInputElement
    expect(second.checked).toBe(true)
    await waitFor(() => expect(window.location.hash).toContain('fix.prompts=p1%2Cp2'))
  })

  it('a page fix ticks its topic questions too and logs the page address and page fix', async () => {
    window.location.hash =
      '#/fixes?drawer=fix&fix=new&fix.page=page-1&fix.prompts=p1,t1,t2&fix.also=topic-1&fix.url=https%3A%2F%2Ftextbolt.com%2Fpricing%2F&fix.pf=pf-1&fix.text=Added+a+table'
    const { source, calls } = fakeSource()
    const topic = {
      ...TARGETS.targets[0]!,
      id: 'topic-1',
      kind: 'topic',
      name: 'Pricing questions',
      url: null
    }
    const withTopic: FixDrawerSource = {
      ...source,
      'prompts:addTargets': () =>
        Promise.resolve({ ...TARGETS, targets: [...TARGETS.targets, topic] } as QuestionTargets),
      'prompts:list': ({ pageId }) =>
        Promise.resolve(
          pageId === 'topic-1'
            ? ({
                pageId,
                prompts: [1, 2, 3].map((n) => ({
                  id: `t${n}`,
                  position: n,
                  label: `Q${n}`,
                  enabled: true,
                  variants: [{ marketId: 'mkt-us', text: `Topic question ${n}?` }]
                }))
              } as unknown as PromptSetView)
            : PROMPTS
        )
    }
    const view = render(<Harness source={withTopic} />)
    const first = await view.findByRole('checkbox', { name: /Topic question 1\?/ })
    expect((first as HTMLInputElement).checked).toBe(true)
    expect(
      (view.getByRole('checkbox', { name: /Topic question 3\?/ }) as HTMLInputElement).checked
    ).toBe(false)
    expect(view.getByText('From the topic Pricing questions')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Log fix' }))
    await waitFor(() => expect(calls.creates).toHaveLength(1))
    expect(calls.creates[0]).toMatchObject({
      pageId: 'page-1',
      promptIds: ['p1', 't1', 't2'],
      url: 'https://textbolt.com/pricing/',
      pageFixId: 'pf-1'
    })
  })

  it('takes a drafted description and kind from the link ("Plan as Fix N")', async () => {
    window.location.hash =
      '#/pages/page-1/progress?view=fixes&drawer=fix&fix=new&fix.page=page-1&fix.prompts=p2&fix.text=Add+the+txt.att.net+step&fix.kind=new_page'
    const { source } = fakeSource()
    const view = render(<Harness source={source} />)
    const second = await view.findByRole('checkbox', { name: /Question 2\?/ })
    expect((second as HTMLInputElement).checked).toBe(true)
    expect((view.getByLabelText('What changed') as HTMLTextAreaElement).value).toBe(
      'Add the txt.att.net step'
    )
    expect((view.getByLabelText('Kind of change') as HTMLSelectElement).value).toBe('new_page')
  })

  it('changes the kind of a fix whose follow-up already ran', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=fix-1&fix.mode=edit'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const kind = (await view.findByLabelText('Kind of change')) as HTMLSelectElement
    expect((view.getByLabelText('Goes live on') as HTMLInputElement).disabled).toBe(true)
    expect(kind.disabled).toBe(false)
    fireEvent.change(kind, { target: { value: 'new_page' } })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(
      () =>
        expect(calls.updates).toEqual([{ projectId: 'proj-1', fixId: 'fix-1', kind: 'new_page' }]),
      // A slow Windows runner needs more than the default second.
      { timeout: 8000 }
    )
  })

  it('shows a fix, edits it, and sends only what changed', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=fix-2'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const shown = await view.findByRole('dialog', { name: 'Fix 2' })
    expect(shown.textContent).toContain('Add a price table')
    fireEvent.click(within(shown).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(window.location.hash).toContain('fix.mode=edit'))
    const text = await view.findByLabelText('What changed')
    fireEvent.change(text, { target: { value: 'Add a price table and an FAQ' } })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(calls.updates).toEqual([
        { projectId: 'proj-1', fixId: 'fix-2', description: 'Add a price table and an FAQ' }
      ])
    )
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?drawer=fix&fix=fix-2'))
    // The view reloads after a save, so it shows the new text.
    await waitFor(() => expect(calls.loads).toBeGreaterThan(1))
  })

  it('runs the follow-up after the confirm, and Delete offers Undo', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=fix-2'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const shown = await view.findByRole('dialog', { name: 'Fix 2' })
    fireEvent.click(within(shown).getByRole('button', { name: 'Run follow-up now' }))
    const confirm = await view.findByRole('alertdialog')
    expect(calls.runs).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run follow-up' }))
    await waitFor(() => expect(calls.runs).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
    expect(await within(shown).findByText(/The follow-up check for Fix 2 started/)).toBeTruthy()
    fireEvent.click(within(shown).getByRole('button', { name: 'Delete Fix 2' }))
    await waitFor(() => expect(calls.deletes).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
    const toast = await view.findByText('Deleted Fix 2.')
    fireEvent.click(
      within(toast.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Undo' })
    )
    await waitFor(() => expect(calls.restores).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
  })

  it('says plainly when the fix in the link is gone', async () => {
    window.location.hash = '#/fixes?drawer=fix&fix=fix-gone'
    const { source } = fakeSource()
    const view = render(<Harness source={source} />)
    expect(
      await view.findByText('That fix is not in this project any more, or is not available to you.')
    ).toBeTruthy()
  })

  it('✦ rewrites the section with my ChatGPT for the picked question; the answer becomes the draft, Undo puts mine back', async () => {
    window.location.hash =
      '#/fixes?drawer=fix&fix=new&fix.page=page-1&fix.prompts=p1,p2&fix.help=chatbot'
    const { source } = fakeSource()
    const help = fakeHelp()
    const view = render(<Harness source={source} helpSource={help} />)
    const what = (await view.findByLabelText('What changed')) as HTMLTextAreaElement
    fireEvent.change(what, { target: { value: 'My own notes.' } })
    await waitFor(() =>
      expect(help.prompts.at(-1)?.scope).toEqual({ pageId: 'page-1', promptId: 'p1' })
    )
    fireEvent.change(view.getByLabelText('Write it for'), { target: { value: 'p2' } })
    await waitFor(() => expect(window.location.hash).toContain('fix.for=p2'))
    await waitFor(() => expect(help.prompts.at(-1)?.scope.promptId).toBe('p2'))
    fireEvent.change(view.getByLabelText('Paste its answer below'), {
      target: { value: 'Yes. Outlook rules forward in 2 minutes.' }
    })
    fireEvent.click(view.getByRole('button', { name: 'Read the answer' }))
    await waitFor(() => expect(what.value).toBe('Yes. Outlook rules forward in 2 minutes.'))
    expect(view.getByText('The draft replaced your text.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    expect(what.value).toBe('My own notes.')
  })
})
