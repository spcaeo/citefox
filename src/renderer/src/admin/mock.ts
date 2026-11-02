import { defaultProjectClaudeSettings } from '@shared/domain'
import type {
  ApiKeyMetadata,
  CompetitorFindings,
  ProjectClaudeSettings,
  ProjectSearchSettings,
  ProjectTemplateOverride,
  ProjectUsageReport,
  SampleCount
} from '@shared/domain'
import type { ProjectSettingsView } from '@shared/ipc'
import type { ShellClient } from '../projects/client'
import type { AdminClient } from './client'

interface MockSettings {
  search: ProjectSearchSettings
  claude: ProjectClaudeSettings
  defaultSamples: SampleCount
  templateOverrides: readonly ProjectTemplateOverride[]
  checkWhenReady: boolean
}

const SAMPLE_COMPETITORS: CompetitorFindings['candidates'] = [
  {
    domain: 'simpletexting.com',
    overviews: 3,
    citations: 4,
    likelyCompetitor: true,
    reason: 'Cited in 3 overviews instead of you',
    listed: false
  },
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
]

/**
 * In-memory admin client for the Vite harness and the mock e2e build. Settings are kept
 * per project in memory; key edits go through the shell's onboarding key store.
 * Duplicate and delete are not part of the sample data.
 */
export function createMockAdminClient(shell: ShellClient): AdminClient {
  const settings = new Map<string, MockSettings>()
  const plans = new Map<string, { plan: string | null; projectIds: readonly string[] }>()

  function settingsFor(projectId: string): MockSettings {
    const found = settings.get(projectId)
    if (found) return found
    const created: MockSettings = {
      search: { source: 'shared', cap: null, capRule: 'pause', dedicatedKeyId: null },
      claude: defaultProjectClaudeSettings(),
      defaultSamples: 1,
      templateOverrides: [],
      checkWhenReady: false
    }
    settings.set(projectId, created)
    return created
  }

  async function view(projectId: string): Promise<ProjectSettingsView> {
    const project = await shell.getProject({ projectId })
    const current = settingsFor(projectId)
    return {
      project,
      markets: project.markets ?? (project.defaultMarket ? [project.defaultMarket] : []),
      search: current.search,
      usage: {
        used: 0,
        allowance: current.search.cap,
        projectedMonthEnd: null,
        resetsOn: nextMonthStart()
      },
      claude: current.claude,
      defaultSamples: current.defaultSamples,
      templateOverrides: current.templateOverrides,
      checkWhenReady: current.checkWhenReady,
      database: {
        path: `~/Library/Application Support/CiteFox/${project.dbPath}`,
        bytes: 0,
        pageCount: project.foundPageCount,
        checkCount: 0
      }
    }
  }

  function decorate(key: ApiKeyMetadata): ApiKeyMetadata {
    const extra = plans.get(key.id)
    return extra ? { ...key, plan: extra.plan, projectIds: extra.projectIds } : key
  }

  return {
    getProjectSettings: (request) => view(request.projectId),
    async updateProjectSettings(request) {
      const current = settingsFor(request.projectId)
      settings.set(request.projectId, {
        search: request.search ?? current.search,
        claude: request.claude ?? current.claude,
        defaultSamples: request.defaultSamples ?? current.defaultSamples,
        templateOverrides: request.templateOverrides ?? current.templateOverrides,
        checkWhenReady: request.checkWhenReady ?? current.checkWhenReady
      })
      return view(request.projectId)
    },
    duplicateProject: () => Promise.reject(new Error('Duplicate is not part of the sample data.')),
    deleteProject: () => Promise.reject(new Error('Delete is not part of the sample data.')),
    async findCompetitors(request) {
      const project = await shell.getProject({ projectId: request.projectId })
      return {
        projectId: project.id,
        domain: project.domain,
        overviewsRead: 6,
        latestCheckAt: new Date().toISOString(),
        candidates: SAMPLE_COMPETITORS.map((item) => ({
          ...item,
          listed: project.competitors.includes(item.domain)
        })),
        nextStep: null
      }
    },
    async projectUsage(): Promise<ProjectUsageReport> {
      const list = await shell.listProjects()
      return {
        month: new Date().toISOString().slice(0, 7),
        projects: list.projects.map((project) => {
          const current = settingsFor(project.id)
          return {
            projectId: project.id,
            name: project.name,
            clientName: project.clientName,
            status: project.status,
            source: current.search.source,
            searches: 0,
            sharedSearches: 0,
            cap: current.search.cap,
            capRule: current.search.capRule,
            allowance: current.search.cap,
            dedicatedKeyId: current.search.dedicatedKeyId,
            sharePercent: null,
            claudeCalls: 0,
            claudeLabel: 'Claude Code (app default)'
          }
        }),
        sharedUsed: 0,
        sharedCapacity: null,
        unassigned: null,
        dedicatedUsed: 0,
        claudeCalls: 0
      }
    },
    connectionActivity: () =>
      Promise.resolve({
        since: new Date(Date.now() - 86_400_000).toISOString(),
        searches: 0,
        claudeCalls: 0,
        jinaReads: 0,
        latestEvent: null
      }),
    connectionActivityLog: () =>
      Promise.resolve({
        since: new Date(Date.now() - 86_400_000).toISOString(),
        searches: 0,
        claudeCalls: 0,
        jinaReads: 0,
        latestEvent: null,
        entries: [],
        latestEvents: [],
        month: new Date().toISOString().slice(0, 7),
        resetsOn: '',
        keyMonth: [],
        keyEvents: []
      }),
    async projectClaude() {
      const list = await shell.listProjects()
      return list.projects
        .filter((project) => project.status !== 'archived')
        .map((project) => ({
          projectId: project.id,
          name: project.name,
          clientName: project.clientName,
          claude: settingsFor(project.id).claude
        }))
    },
    async listKeys() {
      const overview = await shell.getOverview()
      return overview.keys.map(decorate)
    },
    async updateKey(request) {
      let key = (await shell.getOverview()).keys.find((item) => item.id === request.id)
      if (!key) throw new Error('keys:update: That key was not found')
      if (request.name !== undefined)
        key = await shell.renameKey({ id: key.id, name: request.name })
      if (request.monthlyCap !== undefined) {
        key = await shell.setKeyCap({ id: key.id, cap: request.monthlyCap })
      }
      if (request.enabled !== undefined)
        key = await shell.setKeyOn({ id: key.id, on: request.enabled })
      const extra = plans.get(key.id) ?? { plan: null, projectIds: key.projectIds }
      plans.set(key.id, {
        plan: request.plan === undefined ? extra.plan : request.plan,
        projectIds: request.projectIds ?? extra.projectIds
      })
      return decorate(key)
    },
    async reorderKeys(request) {
      const keys = (await shell.getOverview()).keys
      return request.ids
        .map((id) => keys.find((key) => key.id === id))
        .filter((key): key is ApiKeyMetadata => key !== undefined)
        .map((key, index) => decorate({ ...key, rotationOrder: index }))
    },
    exportProject: () =>
      Promise.resolve({
        ok: false,
        reason: 'Export is not part of the sample data.',
        nextStep: null
      })
  }
}

function nextMonthStart(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
}
