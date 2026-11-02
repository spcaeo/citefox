// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  ApiKeyMetadata,
  CompetitorFindings,
  GenerationTemplate,
  ProjectSchedule
} from '@shared/domain'
import type {
  ProjectDetail,
  ProjectSettingsView,
  UpdateProjectRequest,
  UpdateProjectSettingsRequest
} from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import type { AlertsClient, AlertView } from '../alerts/client'
import type { ShellClient } from '../projects/client'
import type { TemplatesClient } from '../templates/client'
import { focusWhenReady } from '../projects/projectsScreen/utils/goTo'
import { PICKER_NEW_VALUE } from '../ui'
import { ProjectSettingsScreen } from '.'

afterEach(() => {
  cleanup()
  // Tabs live in the route (`?tab=`); start each test on General.
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
  includeSubdomains: false,
  brandNames: ['TextBolt'],
  competitors: ['simpletexting.com'],
  defaultMarket: {
    id: 'mkt-us',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  },
  foundPageCount: 3,
  trackedPageCount: 1,
  markets: []
}

function apiKey(id: string, provider: ApiKeyMetadata['provider'], name: string): ApiKeyMetadata {
  return {
    id,
    provider,
    name,
    keychainRef: `ref-${id}`,
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    usedThisMonth: 10
  }
}

const KEYS = [
  apiKey('serp-1', 'serpapi', 'My plan'),
  apiKey('serp-2', 'serpapi', 'Acme key'),
  apiKey('ant-1', 'anthropic', 'My key'),
  apiKey('ant-2', 'anthropic', 'Acme Clinics')
]

function view(project: ProjectDetail = PROJECT): ProjectSettingsView {
  return {
    project,
    markets: [project.defaultMarket!],
    search: { source: 'shared', cap: 3000, capRule: 'pause', dedicatedKeyId: null },
    usage: { used: 1240, allowance: 3000, projectedMonthEnd: 2020, resetsOn: '2026-11-01' },
    claude: {
      connection: 'app_default',
      keyId: null,
      fallback: 'wait',
      fallbackKeyId: null,
      model: null
    },
    defaultSamples: 1,
    templateOverrides: [],
    checkWhenReady: false,
    database: {
      path: '/data/projects/textbolt.sqlite',
      bytes: 2_000_000,
      pageCount: 3,
      checkCount: 4
    }
  }
}

const FINDINGS: CompetitorFindings = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  overviewsRead: 4,
  latestCheckAt: '2026-10-19T12:00:00.000Z',
  candidates: [
    {
      domain: 'twilio.com',
      overviews: 3,
      citations: 3,
      likelyCompetitor: true,
      reason: 'Cited in 3 overviews instead of you',
      listed: false
    },
    {
      domain: 'verizon.com',
      overviews: 1,
      citations: 1,
      likelyCompetitor: false,
      reason: 'Carrier help page, probably not a competitor',
      listed: false
    }
  ],
  nextStep: null
}

interface Harness {
  admin: AdminClient
  client: ShellClient
  settingsUpdates: UpdateProjectSettingsRequest[]
  projectUpdates: UpdateProjectRequest[]
  deletes: string[]
  onChanged: () => Promise<void>
  onDeleted: (activeProjectId: string | null) => Promise<void>
}

function setup(options: { project?: ProjectDetail } = {}): Harness {
  let current = view(options.project)
  const settingsUpdates: UpdateProjectSettingsRequest[] = []
  const projectUpdates: UpdateProjectRequest[] = []
  const deletes: string[] = []
  const admin: AdminClient = {
    getProjectSettings: vi.fn(() => Promise.resolve(current)),
    updateProjectSettings: vi.fn((request: UpdateProjectSettingsRequest) => {
      settingsUpdates.push(request)
      current = {
        ...current,
        search: request.search ?? current.search,
        claude: request.claude ?? current.claude
      }
      return Promise.resolve(current)
    }),
    duplicateProject: vi.fn(() =>
      Promise.resolve({ ...PROJECT, id: 'proj-2', name: 'TextBolt (copy)' })
    ),
    deleteProject: vi.fn((request: { projectId: string; confirmName: string }) => {
      deletes.push(request.confirmName)
      return Promise.resolve({ projectId: request.projectId, activeProjectId: null })
    }),
    findCompetitors: vi.fn(() => Promise.resolve(FINDINGS)),
    projectUsage: vi.fn(),
    connectionActivity: vi.fn(),
    projectClaude: vi.fn(),
    listKeys: vi.fn(),
    updateKey: vi.fn(),
    reorderKeys: vi.fn(),
    exportProject: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        exportId: 'x',
        filePath: '/tmp/textbolt.json',
        filename: 'textbolt.json',
        bytes: 10,
        format: 'json' as const
      })
    )
  }
  const client = {
    updateProject: vi.fn((request: UpdateProjectRequest) => {
      projectUpdates.push(request)
      const project = {
        ...current.project,
        ...(request.competitors ? { competitors: request.competitors } : {}),
        ...(request.status ? { status: request.status } : {}),
        ...(request.clientName !== undefined ? { clientName: request.clientName } : {})
      }
      current = { ...current, project }
      return Promise.resolve(project)
    }),
    getSettings: vi.fn(() =>
      Promise.resolve({
        settings: { claudeProvider: 'claude-code', claudeModel: null },
        dataDirectory: '/data'
      })
    )
  } as unknown as ShellClient
  const schedule: ProjectSchedule = {
    projectId: 'proj-1',
    defaultIntervalDays: 14,
    dailyCheckTime: '09:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    nextCheckAt: null,
    pagesDueToday: 0
  }
  const alerts: AlertView = {
    projectId: 'proj-1',
    desktop: true,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackWebhookStored: false,
    monthlyClientPdf: false,
    monthlyPdfTo: ''
  }
  const alertsClient = {
    getProject: vi.fn(() => Promise.resolve({ value: schedule, unavailable: null })),
    listDue: vi.fn(() =>
      Promise.resolve({ value: { day: '2026-10-20', pages: [] }, unavailable: null })
    ),
    updateProject: vi.fn(() => Promise.resolve({ value: schedule, unavailable: null })),
    getAlerts: vi.fn(() => Promise.resolve({ value: alerts, unavailable: null })),
    updateAlerts: vi.fn(() => Promise.resolve({ value: alerts, unavailable: null }))
  } as unknown as AlertsClient
  const templates: GenerationTemplate[] = []
  const templatesClient = {
    list: vi.fn(() => Promise.resolve(templates))
  } as unknown as TemplatesClient
  const onChanged = vi.fn(() => Promise.resolve())
  const onDeleted = vi.fn(() => Promise.resolve())
  render(
    <ProjectSettingsScreen
      client={client}
      admin={admin}
      alertsClient={alertsClient}
      templatesClient={templatesClient}
      project={options.project ?? PROJECT}
      projects={[PROJECT]}
      keys={KEYS}
      onChanged={onChanged}
      onDeleted={onDeleted}
    />
  )
  return { admin, client, settingsUpdates, projectUpdates, deletes, onChanged, onDeleted }
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

/** Opens a settings tab, then returns its section card. */
async function openSection(name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('tab', { name }))
  return screen.findByRole('region', { name })
}

describe('Project settings screen', () => {
  test('saves the cap rule and a dedicated key', async () => {
    const harness = setup()
    const searches = await openSection('Searches & cost')
    expect(within(searches).getByText('1,240 of 3,000')).toBeTruthy()
    expect(within(searches).getByText(/about 2,020 by Oct 31/)).toBeTruthy()
    fireEvent.click(within(searches).getByLabelText(/Allow 10% over/))
    fireEvent.click(within(searches).getByRole('button', { name: 'Save searches' }))
    await within(searches).findByText('Searches saved.')
    expect(harness.settingsUpdates[0]?.search).toEqual({
      source: 'shared',
      cap: 3000,
      capRule: 'allow_10',
      dedicatedKeyId: null
    })
    fireEvent.click(within(searches).getByLabelText(/A dedicated key/))
    fireEvent.change(within(searches).getByLabelText('Dedicated key'), {
      target: { value: 'serp-2' }
    })
    fireEvent.click(within(searches).getByRole('button', { name: 'Save searches' }))
    await waitFor(() => expect(harness.settingsUpdates).toHaveLength(2))
    expect(harness.settingsUpdates[1]?.search).toMatchObject({
      source: 'dedicated',
      dedicatedKeyId: 'serp-2'
    })
  })

  test('the dedicated key picker opens Add a search key on the URL', async () => {
    setup()
    const searches = await openSection('Searches & cost')
    fireEvent.click(within(searches).getByLabelText(/A dedicated key/))
    const picker = within(searches).getByLabelText('Dedicated key') as HTMLSelectElement
    expect(within(picker).getByRole('option', { name: '+ Add a SerpApi key…' })).toBeTruthy()
    fireEvent.change(picker, { target: { value: PICKER_NEW_VALUE } })
    expect(window.location.hash).toContain('drawer=add-key&key.provider=serpapi')
    expect(picker.value).not.toBe(PICKER_NEW_VALUE)
  })

  test('check new pages automatically when ready: off by default, saved with searches', async () => {
    const harness = setup()
    const searches = await openSection('Searches & cost')
    const toggle = within(searches).getByLabelText(
      /^Check new pages automatically when they are ready/
    ) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    fireEvent.click(within(searches).getByRole('button', { name: 'Save searches' }))
    await within(searches).findByText('Searches saved.')
    expect(harness.settingsUpdates[0]?.checkWhenReady).toBe(true)
  })

  test('the fallback list leaves out the key the project uses, and saves', async () => {
    const harness = setup()
    const claude = await openSection('CiteFox AI')
    fireEvent.change(within(claude).getByLabelText('Connection'), {
      target: { value: 'api_key:ant-1' }
    })
    const fallback = within(claude).getByLabelText('If it hits a limit or fails')
    const labels = within(fallback)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(labels).toEqual([
      'Wait for the plan limit to reset',
      'Switch to Anthropic API · Acme Clinics',
      'Retry later',
      'Ask me'
    ])
    fireEvent.change(fallback, { target: { value: 'switch_key:ant-2' } })
    fireEvent.click(within(claude).getByRole('button', { name: 'Save CiteFox AI settings' }))
    await within(claude).findByText('CiteFox AI settings saved.')
    expect(harness.settingsUpdates[0]?.claude).toEqual({
      connection: 'api_key',
      keyId: 'ant-1',
      fallback: 'switch_key',
      fallbackKeyId: 'ant-2',
      model: null
    })
  })

  test('warns when a client project uses CiteFox AI', async () => {
    setup({ project: { ...PROJECT, clientName: 'Acme Inc.' } })
    const claude = await openSection('CiteFox AI')
    await within(claude).findByText(/client project running on Claude Code/)
  })

  test('finds competitors and adds one with a click', async () => {
    const harness = setup()
    const general = await openSection('General')
    fireEvent.click(
      within(general).getByRole('button', { name: 'Find competitors from AI Overviews' })
    )
    const found = await within(general).findByRole('region', { name: 'Competitor suggestions' })
    expect(within(found).getByText('Carrier help page, probably not a competitor')).toBeTruthy()
    fireEvent.click(within(found).getByRole('button', { name: 'Add twilio.com as a competitor' }))
    await waitFor(() =>
      expect(harness.projectUpdates[0]?.competitors).toEqual(['simpletexting.com', 'twilio.com'])
    )
    await within(found).findByText('On your list')
  })

  test('competitor chips show the site icon with Copy and Open, and still drill and remove', async () => {
    setup()
    const general = await openSection('General')
    const chips = within(general).getByRole('group', { name: 'Competitors' })
    expect(chips.querySelector('[data-url-text="domain"]')).toBeTruthy()
    expect(within(chips).getByRole('button', { name: 'Copy simpletexting.com' })).toBeTruthy()
    expect(
      within(chips).getByRole('link', { name: 'Open simpletexting.com in a new tab' })
    ).toBeTruthy()
    expect(
      within(chips).getByRole('button', {
        name: 'simpletexting.com: show the AI Overviews that cite it'
      })
    ).toBeTruthy()
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove simpletexting.com' }))
    expect(within(chips).getByText('No competitors yet.')).toBeTruthy()
  })

  test('delete needs the exact project name', async () => {
    const harness = setup()
    const data = await openSection('Data')
    fireEvent.click(within(data).getByRole('button', { name: 'Delete project…' }))
    const confirm = within(data).getByRole('button', { name: 'Delete TextBolt for good' })
    fireEvent.change(within(data).getByLabelText(/to confirm/), { target: { value: 'textbolt' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(data).getByLabelText(/to confirm/), { target: { value: 'TextBolt' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(harness.onDeleted).toHaveBeenCalledWith(null))
    expect(harness.deletes).toEqual(['TextBolt'])
  })

  test('archive shows that checks stopped and history is kept', async () => {
    const harness = setup()
    const data = await openSection('Data')
    fireEvent.click(within(data).getByRole('button', { name: 'Archive project' }))
    await within(section('Data')).findByText(
      /checks stopped and it.s hidden from the project switcher/
    )
    expect(harness.projectUpdates[0]).toEqual({ projectId: 'proj-1', status: 'archived' })
    expect(within(section('Data')).getByRole('button', { name: 'Restore project' })).toBeTruthy()
  })

  test('export and duplicate report what happened', async () => {
    const harness = setup()
    const data = await openSection('Data')
    fireEvent.click(within(data).getByRole('button', { name: 'Export project' }))
    await within(data).findByText(/Exported TextBolt as JSON/)
    fireEvent.click(within(data).getByRole('button', { name: 'Duplicate project' }))
    await within(data).findByText(/Created TextBolt \(copy\)/)
    expect(harness.onChanged).toHaveBeenCalled()
  })

  test('sections sit in tabs, and a deep link to a section opens its tab', async () => {
    setup()
    const general = await screen.findByRole('tab', { name: 'General' })
    expect(general.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Data' })).toBeNull()
    focusWhenReady('ps-searches-h')
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Searches & cost' }).getAttribute('aria-selected')
      ).toBe('true')
    )
    await waitFor(() => expect(document.activeElement?.id).toBe('ps-searches-h'))
  })

  test('the Schedule tab is the one home of the re-check, and links the app-wide timing', async () => {
    setup()
    fireEvent.click(await screen.findByRole('tab', { name: 'Schedule' }))
    expect(await screen.findByRole('radio', { name: /Every 14 days/ })).toBeTruthy()
    const link = await screen.findByRole('link', { name: 'App settings › General' })
    expect(link.getAttribute('href')).toBe('#/settings?tab=general')
    expect(
      screen.getByRole('link', { name: 'Alerts & schedules › Notifications' }).getAttribute('href')
    ).toBe('#/alerts/notifications')
    expect(screen.queryByRole('tab', { name: 'Notifications' })).toBeNull()
  })

  test('no project shows the empty state', () => {
    const { container } = render(
      <ProjectSettingsScreen
        client={{} as ShellClient}
        admin={{} as AdminClient}
        alertsClient={{} as AlertsClient}
        templatesClient={{} as TemplatesClient}
        project={null}
        projects={[]}
        keys={[]}
        onChanged={() => Promise.resolve()}
        onDeleted={() => Promise.resolve()}
      />
    )
    expect(container.textContent).toContain('No project yet')
  })
})
