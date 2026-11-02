// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ApiKeyMetadata, ConnectionActivityLog } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { createMockAdminClient } from '../admin/mock'
import { DrillHost } from '../drill'
import { createMockShellClient } from '../projects/mockClient'
import { createMockUsageClient } from '../usage/client'
import { ActivityStrip } from './components/ActivityStrip'
import { ConnectionsScreen } from './ConnectionsScreen'
import { activityDrill, keyProjectsDrill, keyUsageDrill, latestEventDrill } from './utils/drills'

beforeEach(() => {
  // cloro is the default tab; these rows are SerpApi's.
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

function sampleLog(keyId: string): ConnectionActivityLog {
  const entry = (
    id: string,
    kind: 'search' | 'claude_call' | 'jina_read',
    count: number,
    at: string
  ): ConnectionActivityLog['entries'][number] => ({
    id,
    at,
    kind,
    keyId: kind === 'search' ? keyId : null,
    keyName: kind === 'search' ? 'My plan' : null,
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    count,
    detail: null
  })
  return {
    since: '2026-10-19T00:00:00.000Z',
    searches: 3,
    claudeCalls: 1,
    jinaReads: 0,
    latestEvent: {
      at: '2026-10-19T11:30:00.000Z',
      provider: 'serpapi',
      sentence: 'At 11:30, SerpApi rate-limited "My plan". 1 search moved to the next key.'
    },
    entries: [
      entry('s2', 'search', 1, '2026-10-19T11:10:00.000Z'),
      entry('c1', 'claude_call', 1, '2026-10-19T11:05:00.000Z'),
      entry('s1', 'search', 2, '2026-10-19T11:00:00.000Z')
    ],
    latestEvents: [
      {
        id: 'ev-limit',
        at: '2026-10-19T11:30:00.000Z',
        provider: 'serpapi',
        kind: 'rate_limited',
        keyId,
        keyName: 'My plan',
        detail: 'SerpApi is limiting this key.'
      },
      {
        id: 'ev-fo',
        at: '2026-10-19T11:29:00.000Z',
        provider: 'serpapi',
        kind: 'failover',
        keyId,
        keyName: 'My plan',
        detail: 'Moved to the next key.'
      }
    ],
    month: '2026-10',
    resetsOn: '2026-11-01',
    keyMonth: [
      { keyId, projectId: PROJECT.id, projectName: PROJECT.name, searches: 30 },
      { keyId, projectId: null, projectName: null, searches: 4 }
    ],
    keyEvents: []
  }
}

function key(partial: Partial<ApiKeyMetadata> = {}): ApiKeyMetadata {
  return {
    id: 'key-1',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'ref',
    hint: '0001',
    rotationOrder: 1,
    cap: 5000,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    usedThisMonth: 34,
    ...partial
  }
}

describe('Connections drill builders (NFR-14)', () => {
  test('a search call that made two searches lists two rows, so the total matches', () => {
    const log = sampleLog('key-1')
    const drill = activityDrill(log, 'search', PROJECT.id)
    expect(drill.items).toHaveLength(log.searches)
    expect(drill.items.map((item) => item.secondary)).toEqual([
      null,
      'Search 1 of 2 in this call',
      'Search 2 of 2 in this call'
    ])
    expect(drill.items[0]?.target).toEqual({ kind: 'hash', hash: '#/project-settings' })
    expect(activityDrill(log, 'claude_call', null).items).toHaveLength(log.claudeCalls)
    expect(activityDrill(log, 'jina_read', null).items).toHaveLength(0)
  })

  test('another project switches to it and opens its Project settings in one step', () => {
    const drill = activityDrill(sampleLog('key-1'), 'search', 'other')
    expect(drill.items[0]?.target).toEqual({
      kind: 'hash',
      hash: `#/p/${PROJECT.id}/project-settings`
    })
  })

  test('key usage rows add up to CiteFox count and name the reset date', () => {
    const drill = keyUsageDrill(key(), sampleLog('key-1'), PROJECT.id)
    const sum = drill.items.reduce((total, item) => total + Number(item.cells?.searches), 0)
    expect(sum).toBe(34)
    expect(drill.title).toBe('My plan: 34 searches this month')
    expect(drill.description).toMatch(/limit 5,000/)
    expect(drill.items.map((item) => item.primary)).toEqual(['TextBolt', 'No project'])
  })

  test('a shared key lists every project; a client key lists its own', () => {
    const projects = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' }
    ]
    expect(keyProjectsDrill(key(), projects, 'a').items).toHaveLength(2)
    const client = keyProjectsDrill(key({ projectIds: ['b', 'gone'] }), projects, 'a')
    expect(client.items.map((item) => item.primary)).toEqual(['B', 'Removed project'])
    expect(client.items[1]?.target).toBeNull()
  })

  test('the latest failover lists the events its sentence tells', () => {
    const log = sampleLog('key-1')
    expect(latestEventDrill(log).items.map((item) => item.id)).toEqual(['ev-limit', 'ev-fo'])
  })
})

describe('Activity strip drill-downs', () => {
  test('each count is a button whose drawer total equals the number shown', () => {
    const log = sampleLog('key-1')
    const onShowKey = vi.fn()
    render(
      <DrillHost>
        <ActivityStrip activity={log} log={log} error={null} onShowKey={onShowKey} />
      </DrillHost>
    )
    const button = screen.getByRole('button', { name: /3 SerpApi searches/ })
    expect(button.tagName).toBe('BUTTON')
    const figure = button.querySelector('[data-nfr-figure="activity:searches"]')
    expect(figure?.textContent).toBe('3')
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
      'SerpApi searches · 3 searches'
    )
    expect(within(dialog).getAllByRole('row').length - 1).toBe(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /SerpApi rate-limited/ }))
    expect(within(screen.getByRole('dialog')).getByText('Rate-limited')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Show My plan' }))
    expect(onShowKey).toHaveBeenCalledWith('key-1')
  })
})

describe('Key rows', () => {
  async function setup(): Promise<void> {
    const shell = createMockShellClient({ paceMs: 0, wait: () => Promise.resolve() })
    const admin = createMockAdminClient(shell)
    const added = await shell.addKey({
      provider: 'serpapi',
      name: 'My plan',
      secret: 'serp-secret-0001',
      cap: 5000,
      projectIds: []
    })
    vi.spyOn(admin, 'connectionActivityLog').mockResolvedValue(sampleLog(added.id))
    vi.spyOn(admin, 'projectClaude').mockResolvedValue([])
    render(
      <ConnectionsScreen
        client={shell}
        overview={await shell.getOverview()}
        claudeModel={null}
        admin={admin}
        projects={[PROJECT]}
        onChanged={() => Promise.resolve()}
        usageClient={createMockUsageClient()}
      />
    )
    await screen.findByRole('button', { name: /3 SerpApi searches/ })
  }

  test('a row click, the name and the status badge open the key; usage opens per-project use', async () => {
    await setup()
    const table = screen.getByRole('grid', { name: 'SerpApi keys in rotation order' })
    const name = within(table).getByRole('button', { name: /My plan: show its status/ })
    expect(name.getAttribute('aria-expanded')).toBe('false')
    const row = name.closest('[role="row"]')
    if (!row) throw new Error('no row')
    fireEvent.click(row.querySelector('.mono') ?? row)
    expect(name.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('group', { name: 'My plan status' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test again' })).toBeTruthy()
    fireEvent.click(name)
    expect(name.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(within(table).getByRole('button', { name: /My plan status:/ }))
    expect(name.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(within(table).getByRole('button', { name: /searches used on My plan/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('TextBolt')).toBeTruthy()
    expect(within(dialog).getByText(/adds up to 34/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(within(table).getByRole('button', { name: /serves All projects/ }))
    const projects = screen.getByRole('dialog')
    expect(within(projects).getByText('Projects that use My plan · 1 project')).toBeTruthy()
  })

  test('Show key moves focus to the key and opens it', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Show My plan' }))
    const name = screen.getByRole('button', { name: /My plan: show its status/ })
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(name.getAttribute('aria-expanded')).toBe('true')
  })
})
