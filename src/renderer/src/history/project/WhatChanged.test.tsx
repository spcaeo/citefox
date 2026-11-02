// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistDescription, AssistResult, AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { WHAT_CHANGED_META } from './hooks/useWhatChanged'
import { ProjectHistoryScreen } from './index'
import { fakeSource } from './ProjectHistory.fixtures'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/** The recorded reply main's "What changed" tests and the e2e Claude stand-in use. */
const RECORDED = JSON.parse(
  readFileSync(join(process.cwd(), 'src/main/assist/fixtures/history.whatChanged.json'), 'utf8')
) as Pick<AssistResult, 'summary' | 'caution'> & {
  items: Omit<AssistResult['items'][number], 'id'>[]
}

const LABEL = {
  connection: 'claude-code',
  connectionText: 'CiteFox AI · on your plan',
  expectedSeconds: 10,
  text: 'CiteFox AI · on your plan · about 10 s'
} as const

function recordedClient(runs: AssistRunRequest[], caution: string | null = null): AssistClient {
  return {
    describe: async (request): Promise<AssistDescription> => ({
      assistId: request.assistId,
      title: 'What changed',
      label: LABEL,
      savedDataOnly: true,
      searchCost: 0,
      acceptsInstruction: true
    }),
    run: async (request): Promise<AssistResult> => {
      runs.push(request)
      return {
        runId: 'assist-1',
        assistId: request.assistId,
        title: 'What changed',
        summary: RECORDED.summary,
        items: RECORDED.items.map((item, index) => ({ ...item, id: `assist-1-${index + 1}` })),
        caution: caution ?? RECORDED.caution,
        label: LABEL,
        savedDataOnly: true,
        searchesUsed: 0,
        durationMs: 9000,
        model: 'fixture'
      }
    }
  }
}

async function openWhatChanged(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await view.findByRole('treegrid', { name: 'Check history' })
  fireEvent.click(view.getByRole('button', { name: 'AI actions for Check history' }))
  fireEvent.click(await view.findByRole('menuitem', { name: /What changed/ }))
  return (await view.findByTestId('what-changed')).closest('section') as HTMLElement
}

describe('Check history: What changed (AI)', () => {
  it('runs on the grid’s page, market and scope and shows the recorded answer, labelled as AI', async () => {
    window.location.hash = '#/history?scope=pages&market=mkt-uk'
    const runs: AssistRunRequest[] = []
    const { source } = fakeSource()
    const view = render(
      <ProjectHistoryScreen
        projectId="proj-1"
        source={source}
        assistClient={recordedClient(runs)}
      />
    )
    const card = await openWhatChanged(view)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      assistId: 'history.whatChanged',
      projectId: 'proj-1',
      pageId: null,
      marketId: 'mkt-uk',
      inputs: { scope: 'pages' }
    })
    expect(within(card).getByRole('heading', { name: 'What changed' })).toBeTruthy()
    expect(within(card).getByText(WHAT_CHANGED_META)).toBeTruthy()
    expect(within(card).getByText(/CiteFox AI · about 9 s · no searches/)).toBeTruthy()
    expect(within(card).getByText(RECORDED.summary ?? '')).toBeTruthy()
    for (const item of RECORDED.items) expect(within(card).getByText(item.text)).toBeTruthy()
    expect(within(card).getByText('better')).toBeTruthy()
    // Read-only: no ticks and nothing to apply.
    expect(within(card).queryByRole('checkbox')).toBeNull()
    expect(within(card).queryByRole('button', { name: /Apply/ })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss suggestion' }))
    await waitFor(() => expect(view.queryByTestId('what-changed')).toBeNull())
  })

  it('a picked page wins over the scope, and numbers main took out are flagged', async () => {
    window.location.hash = '#/history?page=page-1'
    const runs: AssistRunRequest[] = []
    const { source } = fakeSource()
    const flagged =
      'Took out sentences with numbers that are not in your saved checks (44). Check the grid for those.'
    const view = render(
      <ProjectHistoryScreen
        projectId="proj-1"
        source={source}
        assistClient={recordedClient(runs, flagged)}
      />
    )
    const card = await openWhatChanged(view)
    expect(runs[0]).toMatchObject({ pageId: 'page-1', marketId: null, inputs: {} })
    expect(within(card).getByText(flagged)).toBeTruthy()
  })
})
