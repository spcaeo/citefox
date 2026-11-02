// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AssistItem,
  AssistResult,
  AssistRunRequest,
  PageDetail,
  PageReadResult
} from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { textboltCatalog } from '../mocks/m2/catalog'
import { CLIENT_MODE_STORAGE_KEY } from '../onboarding/flags'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { resetAutoReads } from './autoRead'
import { AudienceScreen } from './AudienceScreen'
import { GapsScreen } from './GapsScreen'
import { PageReadScreen } from './PageReadScreen'
import { PromptsScreen } from './PromptsScreen'

afterEach(() => {
  cleanup()
  resetAutoReads()
  localStorage.removeItem(CLIENT_MODE_STORAGE_KEY)
})

const LABEL = {
  connection: 'claude-code' as const,
  connectionText: 'CiteFox AI · on your plan',
  expectedSeconds: 6,
  text: 'CiteFox AI · on your plan · about 6 s'
}

function item(text: string, tag: string | null = null, detail: string | null = null): AssistItem {
  return { id: `item-${text.length}`, text, detail, tag, verify: null, sign: null }
}

function fakeAssists(itemsFor: (request: AssistRunRequest) => readonly AssistItem[]): {
  client: AssistClient
  requests: AssistRunRequest[]
} {
  const requests: AssistRunRequest[] = []
  return {
    requests,
    client: {
      describe: async (request) => ({
        assistId: request.assistId,
        title: request.assistId,
        label: LABEL,
        savedDataOnly: true,
        searchCost: 0,
        acceptsInstruction: true
      }),
      run: async (request): Promise<AssistResult> => {
        requests.push(request)
        return {
          runId: `run-${requests.length}`,
          assistId: request.assistId,
          title: request.assistId,
          summary: null,
          items: itemsFor(request),
          caution: null,
          label: LABEL,
          savedDataOnly: true,
          searchesUsed: 0,
          durationMs: 1000,
          model: null
        }
      }
    }
  }
}

function shell(): ShellClient {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
}

function page(pageId: string): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

describe('Page read assists', () => {
  it('shows the three assists with their labels and runs them for this page', async () => {
    const { client, requests } = fakeAssists(() => [item('Short title')])
    const view = render(
      <PageReadScreen
        client={shell()}
        projectId="textbolt"
        page={page('alerts')}
        assistClient={client}
      />
    )
    const body = within(view.container)
    const menu = (): HTMLElement => body.getByRole('button', { name: 'AI actions for this page' })
    await waitFor(() => expect(body.getByText(/content fingerprint/)).toBeTruthy())
    fireEvent.click(menu())
    const items = within(document.body)
    expect(items.getByRole('menuitem', { name: /Suggest a shorter title/ })).toBeTruthy()
    expect(items.getByRole('menuitem', { name: /Summarize what this page promises/ })).toBeTruthy()
    expect(items.getByRole('menuitem', { name: /Check facts on the page/ })).toBeTruthy()
    expect(items.getByText('Runs on your AI plan. Uses no searches.')).toBeTruthy()
    expect(body.getByRole('link', { name: 'See all page-wide fixes' })).toBeTruthy()
    fireEvent.click(items.getByRole('menuitem', { name: /Suggest a shorter title/ }))
    await waitFor(() => {
      expect(body.getByRole('region', { name: 'Suggest a shorter title' })).toBeTruthy()
      expect(body.getByText('Short title')).toBeTruthy()
    })
    expect(requests[0]).toMatchObject({
      assistId: 'page.shorterTitle',
      projectId: 'textbolt',
      pageId: 'alerts'
    })
  })

  it('fills "What the page promises" after the promises assist saves its summary', async () => {
    const { client } = fakeAssists(() => [item('Alerts without a developer', 'title')])
    const base = shell()
    let summary: PageReadResult['summary'] = null
    const reads = {
      ...base,
      getRead: async (request: Parameters<ShellClient['getRead']>[0]) => {
        const read = await base.getRead(request)
        return read === null ? null : { ...read, summary }
      }
    }
    const view = render(
      <PageReadScreen
        client={reads}
        projectId="textbolt"
        page={page('alerts')}
        assistClient={client}
      />
    )
    const body = within(view.container)
    await waitFor(() =>
      expect(
        body.getByText('No summary yet. Choose “Summarize what this page promises” in the AI menu.')
      ).toBeTruthy()
    )
    // The main process saves the answer as the read's summary (page.promises `finish`).
    summary = {
      promises: [{ title: 'Set up text alerts with no developer', detail: 'From the title: "…"' }],
      product: null
    }
    fireEvent.click(body.getByRole('button', { name: 'AI actions for this page' }))
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: /Summarize what this page promises/ })
    )
    await waitFor(() => {
      expect(body.getByText('Set up text alerts with no developer')).toBeTruthy()
    })
    expect(body.queryByText(/No summary yet/)).toBeNull()
  })
})

describe('Audience assist', () => {
  it('applies one profile part from the AI menu and Undo restores the previous value', async () => {
    const { client } = fakeAssists(() => [
      item('MSP owners and service-desk leads at 10 to 50 person firms', 'who', 'More concrete.')
    ])
    const view = render(
      <AudienceScreen
        client={shell()}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page('alerts')}
        assistClient={client}
      />
    )
    const body = within(view.container)
    const grid = await body.findByRole('grid', { name: 'Buyer profile points' })
    await waitFor(() => expect(within(grid).getByText(/Who they are/)).toBeTruthy())
    const original = profileWho(grid)
    expect(original.length).toBeGreaterThan(0)
    fireEvent.click(body.getByRole('button', { name: 'AI actions for the buyer profile' }))
    fireEvent.click(await body.findByRole('menuitem', { name: /Sharpen with CiteFox AI/ }))
    const apply = await body.findByRole('button', { name: 'Apply' })
    expect(profileWho(grid)).toBe(original)
    fireEvent.click(apply)
    await waitFor(() => {
      expect(profileWho(grid)).toContain('MSP owners and service-desk leads')
    })
    fireEvent.click(await body.findByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(profileWho(grid)).toBe(original)
    })
  })
})

/** The text of the "Who they are" point: the first point row of the grid. */
function profileWho(grid: HTMLElement): string {
  return grid.querySelector('.au-point-text')?.textContent ?? ''
}

describe('Questions assists', () => {
  function promptsScreen(client: AssistClient): { body: ReturnType<typeof within> } {
    // The prompt-set picker reads saved sets from the mock shell.
    localStorage.setItem(CLIENT_MODE_STORAGE_KEY, 'mock')
    const client0 = shell()
    const view = render(
      <PromptsScreen
        client={client0}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page('alerts')}
        marketId="us"
        onChanged={() => undefined}
        assistClient={client}
      />
    )
    // The drawers follow the URL themselves (`?drawer=pt-rephrase`).
    return { body: within(view.container) }
  }

  function rows(body: ReturnType<typeof within>): HTMLElement[] {
    const grid: HTMLElement = body.getByRole('grid', { name: 'Buyer questions' })
    return Array.from(grid.querySelectorAll('.ui-lg-row'))
  }

  it('adds the suggested questions from the AI menu, only on Apply', async () => {
    const added =
      'Our monitoring tool only emails alerts and my on-call tech sleeps through them, so how do I get those emails sent to his phone as texts without writing code?'
    const { client, requests } = fakeAssists(() => [
      item(added, 'problem', 'Source: trigger event · Maps to: Step 2')
    ])
    const { body } = promptsScreen(client)
    await waitFor(() => expect(rows(body)).toHaveLength(10))
    fireEvent.click(body.getByRole('button', { name: 'AI actions for these questions' }))
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: /Write more like these/ })
    )
    const apply = await body.findByRole('button', { name: 'Add selected' })
    expect(rows(body)).toHaveLength(10)
    fireEvent.click(apply)
    await waitFor(() => expect(rows(body)).toHaveLength(11))
    expect(requests[0]).toMatchObject({ assistId: 'prompts.more', pageId: 'alerts' })
  })

  it('rephrases one question from its row menu and Undo restores its wording', async () => {
    const wording =
      'How do I text my field techs early Saturday morning with a message I write on Friday afternoon, without asking them to install an app?'
    const { client, requests } = fakeAssists(() => [item(wording)])
    const { body } = promptsScreen(client)
    await waitFor(() => expect(rows(body)).toHaveLength(10))
    const firstText = (): string => rows(body)[0]?.querySelector('.pr-text')?.textContent ?? ''
    const original = firstText()
    fireEvent.click(
      body.getAllByRole('button', { name: /^Actions for question / })[0] as HTMLElement
    )
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: /Rephrase like a buyer/ })
    )
    expect(window.location.hash).toContain('drawer=pt-rephrase&pt.rephrase=')
    const dialog = await within(document.body).findByRole('dialog', { name: /Rephrase question/ })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use this wording' }))
    await waitFor(() => expect(firstText()).toBe(wording))
    const request = requests[0]
    expect(request?.assistId).toBe('prompts.rephrase')
    expect(request?.promptId).toBeTruthy()
    expect(request?.inputs).toEqual({ promptId: request?.promptId })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(firstText()).toBe(original))
  })
})

describe('Gaps assist', () => {
  it('drafts the fix for the open question row, copy only', async () => {
    const { client, requests } = fakeAssists(() => [item('New FAQ draft', 'New FAQ')])
    const view = render(
      <GapsScreen
        client={shell()}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page('alerts')}
        marketId="us"
        assistClient={client}
      />
    )
    const body = within(view.container)
    // The fix is drafted in the One by one view (v2 tabs), for the open prompt.
    fireEvent.click(await body.findByRole('tab', { name: /^One by one/ }))
    fireEvent.click(await body.findByRole('button', { name: /^AI actions for question \d+$/ }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: /^Draft the fix/ }))
    await waitFor(() => {
      expect(body.getByText('New FAQ draft')).toBeTruthy()
    })
    expect(body.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(body.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(requests[0]).toMatchObject({ assistId: 'gaps.draftFix', marketId: 'us' })
    expect(requests[0]?.promptId).toBeTruthy()
  })
})
