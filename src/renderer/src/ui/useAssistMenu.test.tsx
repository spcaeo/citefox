// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { describeMockAssist, runMockAssist } from '../assist/mock'
import { useAssistMenu, type AssistMenuAction } from './useAssistMenu'

afterEach(cleanup)

function recording(): { client: AssistClient; requests: AssistRunRequest[] } {
  const requests: AssistRunRequest[] = []
  return {
    requests,
    client: {
      describe: describeMockAssist,
      run: async (request) => {
        requests.push(request)
        return runMockAssist(request)
      }
    }
  }
}

function Harness({
  client,
  actions
}: {
  client: AssistClient
  actions: readonly AssistMenuAction[]
}): JSX.Element {
  const { menu, card } = useAssistMenu({
    scope: { projectId: 'p1', pageId: 'page-1', marketId: 'mkt-us', client },
    actions
  })
  return (
    <div>
      {menu}
      {card}
    </div>
  )
}

describe('useAssistMenu', () => {
  it('runs the picked assist for the scope and shows one card, then the next one', async () => {
    const { client, requests } = recording()
    const view = render(
      <Harness
        client={client}
        actions={[
          { assistId: 'results.explainChange', label: 'Explain this change', seconds: 6 },
          { assistId: 'report.summary', label: 'Summarize this run' }
        ]}
      />
    )
    const body = within(view.container)
    fireEvent.click(body.getByRole('button', { name: 'AI actions' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: /Explain this change/ }))
    await waitFor(() =>
      expect(body.getByRole('region', { name: 'Explain this change' })).toBeTruthy()
    )
    expect(requests[0]).toMatchObject({
      assistId: 'results.explainChange',
      projectId: 'p1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: null
    })

    fireEvent.click(body.getByRole('button', { name: 'AI actions' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: /Summarize this run/ }))
    await waitFor(() =>
      expect(body.getByRole('region', { name: 'Summarize this run' })).toBeTruthy()
    )
    expect(requests[1]?.assistId).toBe('report.summary')
    expect(body.queryByRole('region', { name: 'Explain this change' })).toBeNull()

    fireEvent.click(body.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(body.queryByRole('region', { name: 'Summarize this run' })).toBeNull()
  })
})
