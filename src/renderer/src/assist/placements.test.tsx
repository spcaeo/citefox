// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistRunRequest } from '@shared/ipc'
import { RunAssists } from '../m3/ResultsAssists'
import { usePromptAssists } from '../promptDetail/components/PromptAssists'
import { useProgressAssistMenu } from '../visibility/ProgressAssists'
import type { AssistClient } from './client'
import { describeMockAssist, runMockAssist } from './mock'

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

/** Opens a section's one AI menu, picks `item`, and waits for its suggestion card. */
async function runSectionMenu(container: HTMLElement, menu: string, item: string): Promise<void> {
  const body = within(container)
  fireEvent.click(body.getByRole('button', { name: menu }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: new RegExp(item) }))
  await waitFor(() => {
    expect(body.getByRole('region', { name: item })).toBeTruthy()
  })
}

/** Prompt detail's AI menu and its suggestion card, as the screen renders them. */
function PromptAssistsHarness({
  first,
  client
}: {
  first: boolean
  client: AssistClient
}): JSX.Element {
  const { menu, card } = usePromptAssists({
    projectId: 'p1',
    pageId: 'page-1',
    marketId: 'mkt-us',
    promptId: 'prompt-1',
    first,
    client
  })
  return (
    <div>
      {menu}
      {card}
    </div>
  )
}

/** Progress shows its assists as one AI menu; this renders the menu and its card. */
function ProgressMenu(props: {
  marketId: string | null
  nextFixNumber: number
  fixNumber: number | null
  client: AssistClient
}): JSX.Element {
  const { menu, card } = useProgressAssistMenu({ projectId: 'p1', pageId: 'page-1', ...props })
  return (
    <div>
      {menu}
      {card}
    </div>
  )
}

/** Opens the prompt's AI menu, picks an item, and waits for its suggestion card. */
async function runMenuItem(container: HTMLElement, item: RegExp, title: string): Promise<void> {
  const body = within(container)
  fireEvent.click(body.getByRole('button', { name: 'AI actions for this question' }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: item }))
  await waitFor(() => {
    expect(body.getByRole('region', { name: title })).toBeTruthy()
  })
}

async function runMenu(container: HTMLElement, name: string): Promise<void> {
  const body = within(container)
  fireEvent.click(body.getByRole('button', { name: 'AI actions' }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: new RegExp(`^${name}`) }))
  await waitFor(() => {
    expect(body.getByRole('region', { name })).toBeTruthy()
  })
}

describe('assist placements', () => {
  it('Results: explain the change and summarize the run for the shown market', async () => {
    const { client, requests } = recording()
    const view = render(
      <RunAssists
        scope={{ projectId: 'p1', pageId: 'page-1', marketId: 'mkt-uk', client }}
        hasPrevious
      />
    )
    await runSectionMenu(view.container, 'AI actions for the summary', 'Explain this change')
    expect(requests[0]).toMatchObject({
      assistId: 'results.explainChange',
      projectId: 'p1',
      pageId: 'page-1',
      marketId: 'mkt-uk',
      promptId: null
    })
    await runSectionMenu(view.container, 'AI actions for the summary', 'Summarize this run')
    expect(requests[1]?.assistId).toBe('report.summary')
  })

  it('Results: no Explain this change on a first check', () => {
    const { client } = recording()
    const view = render(
      <RunAssists
        scope={{ projectId: 'p1', pageId: 'page-1', marketId: 'mkt-us', client }}
        hasPrevious={false}
      />
    )
    fireEvent.click(
      within(view.container).getByRole('button', { name: 'AI actions for the summary' })
    )
    expect(
      within(document.body).queryByRole('menuitem', { name: /Explain this change/ })
    ).toBeNull()
    expect(within(document.body).getByRole('menuitem', { name: /Summarize this run/ })).toBeTruthy()
  })

  it('Question detail: draft fix and why not first carry the question id', async () => {
    const { client, requests } = recording()
    const view = render(<PromptAssistsHarness first={false} client={client} />)
    await runMenuItem(view.container, /Why isn't my page first/, "Why isn't my page first?")
    expect(requests[0]).toMatchObject({ assistId: 'results.whyNotFirst', promptId: 'prompt-1' })
    await runMenuItem(view.container, /Draft the fix/, 'Draft the fix')
    expect(requests[1]).toMatchObject({ assistId: 'gaps.draftFix', promptId: 'prompt-1' })
  })

  it('Question detail: hides why not first when the page is already first', () => {
    const { client } = recording()
    const view = render(<PromptAssistsHarness first client={client} />)
    fireEvent.click(
      within(view.container).getByRole('button', { name: 'AI actions for this question' })
    )
    const menu = within(document.body)
    expect(menu.getByRole('menuitem', { name: /Draft the fix/ })).toBeTruthy()
    expect(menu.queryByRole('menuitem', { name: /Why isn't my page first/ })).toBeNull()
  })

  it('Progress: other markets sends the fix number and says no new searches', async () => {
    const { client, requests } = recording()
    const view = render(
      <ProgressMenu marketId="mkt-us" nextFixNumber={3} fixNumber={1} client={client} />
    )
    const body = within(view.container)
    fireEvent.click(body.getByRole('button', { name: 'AI actions' }))
    expect(within(document.body).getByText(/No new searches\.$/)).toBeTruthy()
    fireEvent.keyDown(within(document.body).getAllByRole('menuitem')[0] as HTMLElement, {
      key: 'Escape'
    })
    await runMenu(view.container, 'Check if Fix 1 worked in other markets')
    expect(requests[0]).toMatchObject({
      assistId: 'progress.otherMarkets',
      inputs: { fixNumber: 1 }
    })
    await waitFor(() => {
      expect(body.getByText(/no searches/)).toBeTruthy()
    })
    await runMenu(view.container, 'Draft Fix 3')
    expect(requests[1]).toMatchObject({ assistId: 'progress.draftFix', inputs: { fixNumber: 3 } })
  })

  it('Progress: no other-markets check before any fix is logged', () => {
    const { client } = recording()
    const view = render(
      <ProgressMenu marketId={null} nextFixNumber={1} fixNumber={null} client={client} />
    )
    fireEvent.click(within(view.container).getByRole('button', { name: 'AI actions' }))
    const page = within(document.body)
    expect(page.getByRole('menuitem', { name: /^Suggest next fix/ })).toBeTruthy()
    expect(page.queryByRole('menuitem', { name: /worked in other markets/ })).toBeNull()
  })
})
