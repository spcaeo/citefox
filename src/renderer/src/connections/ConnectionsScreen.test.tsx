// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { useCallback, useState, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectDetail, ProjectSettingsView } from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import { createMockAdminClient } from '../admin/mock'
import type { OnboardingConnections } from '../onboarding/claudeLogin'
import { createMockShellClient } from '../projects/mockClient'
import type { ShellClient } from '../projects/client'
import { createMockOnboardingClient } from '../onboarding/mockClient'
import { createMockUsageClient } from '../usage/client'
import { ConnectionsScreen } from './ConnectionsScreen'

beforeEach(() => {
  // The open tab lives in the hash; cloro is the default, so start each test on SerpApi.
  window.location.hash = '#/connections?tab=serpapi'
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = ''
})

const PROJECT: ProjectDetail = {
  id: 'proj-1',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: 'projects/textbolt.sqlite',
  clientName: null,
  status: 'active',
  includeSubdomains: true,
  brandNames: ['TextBolt'],
  competitors: [],
  defaultMarket: null,
  foundPageCount: 0,
  trackedPageCount: 0
}

function Harness({
  shell,
  admin,
  first
}: {
  shell: ShellClient
  admin: AdminClient
  first: OnboardingConnections
}): JSX.Element {
  const [overview, setOverview] = useState(first)
  const reload = useCallback(async () => {
    setOverview(await shell.getOverview())
  }, [shell])
  return (
    <ConnectionsScreen
      client={shell}
      overview={overview}
      claudeModel={null}
      admin={admin}
      projects={[PROJECT]}
      onChanged={reload}
      usageClient={createMockUsageClient()}
    />
  )
}

async function setup(): Promise<{ shell: ShellClient; admin: AdminClient }> {
  const shell = createMockShellClient({ paceMs: 0, wait: () => Promise.resolve() })
  const admin = createMockAdminClient(shell)
  await shell.addKey({
    provider: 'serpapi',
    name: 'My plan',
    secret: 'serp-secret-0001',
    cap: 5000,
    projectIds: []
  })
  vi.spyOn(admin, 'projectClaude').mockResolvedValue([
    {
      projectId: PROJECT.id,
      name: PROJECT.name,
      clientName: null,
      claude: {
        connection: 'app_default',
        keyId: null,
        fallback: 'wait',
        fallbackKeyId: null,
        model: null
      }
    }
  ])
  render(<Harness shell={shell} admin={admin} first={await shell.getOverview()} />)
  await screen.findByText('No failovers in the last 24 hours.')
  return { shell, admin }
}

function openTab(name: string): void {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
}

/** Opens a key's row menu and picks one item. */
function rowAction(scope: HTMLElement, keyName: string, item: string): void {
  fireEvent.click(within(scope).getByRole('button', { name: `Actions for ${keyName}` }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name })
  const found = heading.closest('section')
  if (!found) throw new Error(`No section for ${name}`)
  return found
}

describe('Connections at scale', () => {
  test('the open tab is in the URL, and the URL opens its tab', async () => {
    window.location.hash = '#/connections?tab=jina'
    await setup()
    expect(screen.getByRole('tab', { name: /^Jina Reader/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    openTab('Claude')
    expect(window.location.hash).toBe('#/connections?tab=claude')
    openTab('SerpApi')
    expect(window.location.hash).toBe('#/connections?tab=serpapi')
    // cloro is first, tagged Recommended, and the default: its URL has no tab.
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs.slice(0, 2)).toEqual(['cloroRecommended', 'SerpApi1'])
    openTab('cloro')
    expect(window.location.hash).toBe('#/connections')
    cleanup()
    window.location.hash = '#/connections'
    await setup()
    expect(
      screen.getByRole('tab', { name: /^cloro Recommended/ }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'cloro keys' })).toBeTruthy()
  })

  test('adds a second SerpApi key, keeps rotation order, and sorts the view only', async () => {
    const { admin } = await setup()
    const serp = section('SerpApi keys')
    fireEvent.click(within(serp).getByRole('button', { name: 'Add SerpApi key' }))
    fireEvent.change(within(serp).getByLabelText('API key', { exact: true }), {
      target: { value: 'serp-secret-0002' }
    })
    fireEvent.change(within(serp).getByLabelText('Name'), { target: { value: 'Backup' } })
    fireEvent.change(within(serp).getByLabelText(/Monthly cap/), { target: { value: '250' } })
    // The 3-step key card: sign up, open the dashboard, paste and Test and save.
    expect(within(serp).getByRole('list', { name: 'Connect SerpApi in 3 steps' })).toBeTruthy()
    expect(
      within(serp)
        .getByRole('link', { name: /^Open dashboard at SerpApi/ })
        .getAttribute('href')
    ).toBe('https://serpapi.com/manage-api-key')
    fireEvent.click(within(serp).getByRole('button', { name: 'Test and save' }))
    await within(serp).findByText(/^Backup tested and saved\. Key works/)
    expect(
      within(serp).getByText('2 keys. CiteFox used 0 of 5,250 capped searches this month.')
    ).toBeTruthy()
    const grid = within(serp).getByRole('grid', { name: 'SerpApi keys in rotation order' })
    const rows = within(grid).getAllByRole('row').slice(1)
    // The tested key shows its plan under its name.
    expect(rows.map((row) => within(row).getAllByRole('gridcell')[1]?.textContent)).toEqual([
      'My plan',
      'BackupDeveloper'
    ])
    expect(within(serp).queryByText('serp-secret-0002')).toBeNull()

    const reorder = vi.spyOn(admin, 'reorderKeys')
    rowAction(serp, 'Backup', 'Move up in rotation order')
    await waitFor(() => expect(reorder).toHaveBeenCalled())
    const ids = reorder.mock.calls[0]?.[0].ids ?? []
    expect(ids).toHaveLength(2)
    expect(reorder.mock.calls[0]?.[0].provider).toBe('serpapi')

    await within(serp).findByText('Backup moved up in rotation order.')

    // Sorting a header changes the view only; the Order column keeps the rotation number.
    fireEvent.click(within(grid).getByRole('button', { name: /^Name/ }))
    fireEvent.click(within(grid).getByRole('button', { name: /^Name/ }))
    const sorted = within(grid).getAllByRole('row').slice(1)
    expect(sorted.map((row) => within(row).getAllByRole('gridcell')[1]?.textContent)).toEqual([
      'My plan',
      'BackupDeveloper'
    ])
    expect(within(serp).getByText(/CiteFox rotates keys in Order-column order/)).toBeTruthy()
  })

  test('saves the rotation rule and a project Claude fallback', async () => {
    const { shell, admin } = await setup()
    const update = vi.spyOn(shell, 'updateSettings')
    fireEvent.change(screen.getByLabelText('How CiteFox uses these keys'), {
      target: { value: 'spread_evenly' }
    })
    await waitFor(() => expect(update).toHaveBeenCalledWith({ serpapiRotation: 'spread_evenly' }))
    await screen.findByText(/Saved\. Spread evenly from the next search\./)

    openTab('Claude')
    const claude = section('Claude')
    const save = vi
      .spyOn(admin, 'updateProjectSettings')
      .mockImplementation((request) =>
        Promise.resolve({ claude: request.claude } as unknown as ProjectSettingsView)
      )
    const fallback = await within(claude).findByLabelText('TextBolt fallback')
    fireEvent.change(fallback, { target: { value: 'retry_later' } })
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        projectId: 'proj-1',
        claude: expect.objectContaining({ fallback: 'retry_later' })
      })
    )
    await within(claude).findByText('Saved for TextBolt.')
    expect(
      within(claude).getByText(/doesn't rotate between several Claude subscription/)
    ).toBeTruthy()
  })

  test('edits a key, turns it off, and passes axe', async () => {
    const { admin } = await setup()
    const serp = section('SerpApi keys')
    const update = vi.spyOn(admin, 'updateKey')
    rowAction(serp, 'My plan', 'Edit key')
    fireEvent.change(within(serp).getByLabelText('Plan'), { target: { value: 'Developer' } })
    fireEvent.click(within(serp).getByLabelText('TextBolt'))
    fireEvent.click(within(serp).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'My plan',
        plan: 'Developer',
        monthlyCap: 5000,
        projectIds: ['proj-1']
      })
    )
    await within(serp).findByText('My plan saved.')
    await act(async () => {
      fireEvent.click(within(serp).getByRole('switch', { name: 'Use My plan' }))
    })
    await within(serp).findByText('My plan is off.')
    expect(within(serp).getByText('Off', { exact: true })).toBeTruthy()
    const result = await axe.run(document.body, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  }, 20_000)
})

describe('ConnectionsScreen', () => {
  test('shows Claude usage in the Claude section', async () => {
    const client = createMockOnboardingClient({
      scenario: () => 'success',
      paceMs: 0,
      wait: () => Promise.resolve()
    })
    const overview = await client.getOverview()
    const view = render(
      <ConnectionsScreen
        client={client}
        overview={overview}
        claudeModel={null}
        onChanged={async () => undefined}
        usageClient={createMockUsageClient()}
      />
    )
    fireEvent.click(view.getByRole('tab', { name: 'Claude' }))
    const claude = within(view.getByRole('region', { name: 'Claude' }))
    const usage = within(claude.getByRole('region', { name: 'Calls and tokens' }))
    const today = await usage.findByRole('region', { name: 'Calls today' })
    expect(today.textContent).toContain('31')
    expect(usage.getByRole('region', { name: 'Tokens in · month' }).textContent).toContain('1.3M')
    fireEvent.click(usage.getByRole('tab', { name: /^By connection/ }))
    expect(usage.getByText('CiteFox AI on this computer')).toBeTruthy()
  })
})
