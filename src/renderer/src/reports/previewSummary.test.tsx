// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistRunRequest, HelpFillPromptRequest, ProjectDetail } from '@shared/ipc'
import type { HelpFillSource } from '../ui'
import { createMockAssistClient, type AssistClient } from '../assist/client'
import { createMockSchedulesClient } from './schedulesMock'
import { ReportsScreen } from './ReportsScreen'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function harbor(): ProjectDetail {
  return {
    id: 'harbor',
    name: 'Harbor',
    slug: 'harbor',
    domain: 'harbor.example',
    dbPath: 'projects/harbor.sqlite',
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: ['Harbor'],
    competitors: [],
    defaultMarket: null,
    foundPageCount: 1,
    trackedPageCount: 1
  }
}

/** The mock assist client, recording each run. */
function recordingClient(runs: AssistRunRequest[]): AssistClient {
  const mock = createMockAssistClient()
  return {
    describe: (request) => mock.describe(request),
    run: (request) => {
      runs.push(request)
      return mock.run(request)
    }
  }
}

function fakeHelp(): HelpFillSource & { prompts: HelpFillPromptRequest[] } {
  const prompts: HelpFillPromptRequest[] = []
  return {
    prompts,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: false,
      calls: 0,
      costText: '',
      reason: 'Uses your own chatbot.'
    }),
    'helpfill:prompt': async (request) => {
      prompts.push(request)
      return {
        kind: 'reportSummary',
        prompt: 'Write a short summary of this report in my voice.',
        columns: [],
        tracked: 0
      }
    },
    // Main's number check took a sentence out: the banner says so.
    'helpfill:read': async () => ({
      kind: 'reportSummary',
      rows: [{ id: 'r0', section: null, values: { text: 'We are cited on 8 of 10 questions.' } }],
      setAside: [],
      counts: { read: 1, tracked: 0, repeats: 0, setAside: 0, ready: 1 },
      noun: ['summary', 'summaries'],
      brand: 'Harbor',
      warnings: ['Took out 1 sentence with a number not in the report: 47.'],
      text: 'We are cited on 8 of 10 questions.'
    }),
    'helpfill:describe': async () => {
      throw new Error('no Describe here')
    }
  }
}

function openForm(
  runs: AssistRunRequest[],
  page: { id: string; name: string } | null,
  helpSource?: HelpFillSource
): ReturnType<typeof render> {
  const view = render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="UTC"
      projects={[harbor()]}
      summaryPage={async () => page}
      assistClient={recordingClient(runs)}
      {...(helpSource ? { helpSource } : {})}
    />
  )
  fireEvent.click(view.getByRole('button', { name: 'New schedule' }))
  fireEvent.change(view.getByLabelText('Project'), { target: { value: 'harbor' } })
  return view
}

function pick(view: ReturnType<typeof render>, label: string): void {
  fireEvent.click(view.getByRole('button', { name: 'AI actions for the summary' }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: new RegExp(label) }))
}

describe('Scheduled reports › AI summary', () => {
  it('runs report.summary on the project’s latest checked page, not fixed text', async () => {
    const runs: AssistRunRequest[] = []
    const view = openForm(runs, { id: 'page-1', name: 'Pricing' })
    const preview = await view.findByRole('region', { name: 'Email preview' })
    await waitFor(() => expect(preview.textContent).toContain('Latest check of Pricing'))
    pick(view, 'Write the summary with CiteFox AI')
    await waitFor(() =>
      expect(preview.textContent).toContain('Google showed an AI Overview for 8 of 10 questions.')
    )
    expect(preview.textContent).not.toContain('CiteFox AI writes this fresh')
    expect(runs[0]).toMatchObject({
      assistId: 'report.summary',
      projectId: 'harbor',
      pageId: 'page-1',
      instruction: null
    })
  })

  it('asks for a client-friendly rewrite with an instruction', async () => {
    const runs: AssistRunRequest[] = []
    const view = openForm(runs, { id: 'page-1', name: 'Pricing' })
    const preview = await view.findByRole('region', { name: 'Email preview' })
    await waitFor(() => expect(preview.textContent).toContain('Latest check of Pricing'))
    pick(view, 'Make it client-friendly')
    await waitFor(() => expect(runs).toHaveLength(1))
    expect(runs[0]?.instruction).toMatch(/client/i)
    await waitFor(() =>
      expect(
        within(preview).getByRole('button', { name: 'Use the client-friendly summary' })
      ).toBeTruthy()
    )
  })

  it('says why the AI actions are off with no checked page', async () => {
    const runs: AssistRunRequest[] = []
    const view = openForm(runs, null)
    const preview = await view.findByRole('region', { name: 'Email preview' })
    await waitFor(() =>
      expect(preview.textContent).toContain('No checked page in this project yet')
    )
    // Every action is off, so the menu does not open and nothing runs.
    fireEvent.click(view.getByRole('button', { name: 'AI actions for the summary' }))
    expect(within(document.body).queryByRole('menuitem')).toBeNull()
    expect(runs).toHaveLength(0)
  })

  it('writes it in your own voice with my ChatGPT: on the URL, numbers checked, shown with Copy', async () => {
    const runs: AssistRunRequest[] = []
    const help = fakeHelp()
    const view = openForm(runs, { id: 'page-1', name: 'Pricing' }, help)
    const preview = await view.findByRole('region', { name: 'Email preview' })
    await waitFor(() => expect(preview.textContent).toContain('Latest check of Pricing'))
    pick(view, 'Write it in your own voice with my ChatGPT')
    await waitFor(() => expect(window.location.hash).toContain('schedule.help=chatbot'))
    const own = await within(preview).findByTestId('rpt-own')
    // A new schedule: the prompt is about the project (no saved schedule yet).
    await waitFor(() =>
      expect(help.prompts[0]).toMatchObject({
        kind: 'reportSummary',
        projectId: 'harbor',
        scope: { pageId: null }
      })
    )
    // The chatbot way only: no way cards, and no Claude run.
    expect(within(own).queryByRole('radio', { name: /Describe it/u })).toBeNull()
    fireEvent.change(within(own).getByLabelText('Paste its answer below'), {
      target: { value: 'We are cited on 8 of 10 questions. Traffic is up 47%.' }
    })
    fireEvent.click(within(own).getByRole('button', { name: 'Read the answer' }))
    await waitFor(() =>
      expect(within(own).getByTestId('rpt-own-result').textContent).toContain(
        'We are cited on 8 of 10 questions.'
      )
    )
    expect(within(own).getByTestId('rpt-own-hf-summary').textContent).toContain(
      'Took out 1 sentence with a number not in the report: 47.'
    )
    expect(within(own).getByText(/not saved with it/u)).toBeTruthy()
    expect(runs).toHaveLength(0)
    fireEvent.click(within(own).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(window.location.hash).not.toContain('schedule.help'))
  })
})
