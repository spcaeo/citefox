import {
  CLORO_CREDITS,
  DEFAULT_INTERVAL_DAYS,
  ENGINE_IDS,
  ENGINE_LABEL,
  normaliseEngines,
  providerPlan,
  type EngineId,
  type ProjectSchedule,
  type ProviderChoice
} from '@shared/domain'
import type {
  EngineEstimate,
  HelpFillResult,
  HelpFillRow,
  ProjectEnginesView,
  SetProjectEnginesRequest,
  UpdateProjectScheduleRequest
} from '@shared/ipc'
import type { SetupServices } from './setupServices'

/**
 * The mock build's (and unit tests') {@link SetupServices}: a chatbot answer about
 * textbolt.com, one project's engines and schedule in memory, and an estimate with
 * cloro's Lite plan. Nothing leaves the window.
 */
export interface MockSetupServices extends SetupServices {
  /** What `engines:set` and `schedule:updateProject` received, in order. */
  calls: { channel: string; request: unknown }[]
}

const row = (id: string, section: string, values: Record<string, string>): HelpFillRow => ({
  id,
  section,
  values
})

/** What main's reader returns for a full ChatGPT answer about textbolt.com. */
export const MOCK_CHATBOT_ANSWER: HelpFillResult = {
  kind: 'project',
  rows: [
    row('p1', 'products', {
      name: 'Email-to-SMS gateway',
      url: '/email-to-text/',
      job: 'Turns emails into texts'
    }),
    row('p2', 'products', { name: 'Business texting', url: '/business-texting/', job: '' }),
    row('b1', 'buyers', {
      who: 'IT sysadmin at a mid-size company',
      problem: 'Datadog alerts went to a carrier gateway; on-call texts stopped.',
      trigger: 'AT&T gateway shut down June 2025',
      product: 'Email-to-SMS gateway'
    }),
    row('b2', 'buyers', {
      who: 'Practice manager at a small clinic',
      problem: 'Sends reminders from Gmail; must add texting without retraining staff.',
      trigger: 'Verizon vtext sunset 2027',
      product: 'Business texting'
    }),
    row('c1', 'competitors', {
      name: 'Textmagic',
      domain: 'textmagic.com',
      competes_with: 'Email-to-SMS gateway'
    }),
    row('c2', 'competitors', {
      name: 'ClickSend',
      domain: 'clicksend.com',
      competes_with: 'Email-to-SMS gateway'
    }),
    row('m1', 'markets', { country: 'US', language: 'en', city: '' }),
    row('q1', 'questions', {
      question: 'Our Datadog alerts to the AT&T gateway stopped. What changed?',
      stage: 'problem',
      product: 'Email-to-SMS gateway'
    }),
    row('q2', 'questions', {
      question: 'What does an email-to-text replacement cost?',
      stage: 'decide',
      product: 'Email-to-SMS gateway'
    })
  ],
  setAside: [],
  counts: { read: 9, tracked: 0, repeats: 0, setAside: 0, ready: 9 },
  noun: ['item', 'items'],
  brand: null,
  warnings: []
}

export function createMockSetupServices(
  options: { available?: boolean; cloroReady?: boolean } = {}
): MockSetupServices {
  const available = options.available ?? true
  const calls: MockSetupServices['calls'] = []
  let engines: EngineId[] = ['google_aio']
  let provider: ProviderChoice = 'auto'
  let schedule: ProjectSchedule | null = null

  function view(projectId: string): ProjectEnginesView {
    const cloroReady = options.cloroReady ?? provider !== 'serpapi'
    return {
      projectId,
      engines: [...engines],
      provider,
      activeProvider: provider === 'serpapi' ? 'serpapi' : 'cloro',
      cloroReady,
      serpapiReady: provider === 'serpapi',
      options: ENGINE_IDS.map((id) => ({
        id,
        label: ENGINE_LABEL[id],
        credits: CLORO_CREDITS[id],
        needsCloro: id !== 'google_aio',
        runnable: id === 'google_aio' || cloroReady
      })),
      overrides: 0,
      updatedAt: null
    }
  }

  function estimate(projectId: string, picked: readonly EngineId[]): EngineEstimate {
    const searchProvider = provider === 'serpapi' ? 'serpapi' : 'cloro'
    const plan = providerPlan(searchProvider, null)
    const zero = { searches: 0, credits: 0, costMicros: 0 }
    return {
      projectId,
      provider: searchProvider,
      cloroReady: searchProvider === 'cloro',
      pages: 0,
      questions: 0,
      perCheck: zero,
      perMonth: zero,
      byEngine: picked.map((engine) => ({
        ...zero,
        engine,
        label: ENGINE_LABEL[engine],
        calls: 0,
        runnable: true
      })),
      plans: [{ provider: searchProvider, label: plan.label, usd: plan.usd, units: plan.units }],
      skipped: []
    }
  }

  return {
    calls,
    'helpfill:setupEstimate': async () => ({
      kind: 'project',
      available,
      calls: 5,
      costText: available ? 'Up to 5 Claude calls · on your Claude plan' : 'Up to 5 Claude calls',
      reason: available ? null : 'Claude is not set up.'
    }),
    'helpfill:setupPrompt': async ({ site }) => ({
      kind: 'project',
      prompt: `You help set up AI-search tracking for ${site.domain}.\n\n### PRODUCTS\nname,url,job`,
      columns: ['name', 'url', 'job'],
      tracked: 0
    }),
    'helpfill:setupRead': async () => MOCK_CHATBOT_ANSWER,
    'topics:createTopics': async (request) => ({
      topicIds: request.topics.map((_, index) => `topic-${index + 1}`),
      questions: 0,
      message: ''
    }),
    'engines:get': async ({ projectId }) => view(projectId),
    'engines:set': async (request: SetProjectEnginesRequest) => {
      calls.push({ channel: 'engines:set', request })
      if (request.engines) engines = normaliseEngines(request.engines)
      if (request.provider) provider = request.provider
      return view(request.projectId)
    },
    'engines:estimate': async ({ projectId, engines: picked }) =>
      estimate(projectId, picked ?? engines),
    'schedule:updateProject': async (request: UpdateProjectScheduleRequest) => {
      calls.push({ channel: 'schedule:updateProject', request })
      schedule = {
        projectId: request.projectId,
        defaultIntervalDays:
          request.defaultIntervalDays ?? schedule?.defaultIntervalDays ?? DEFAULT_INTERVAL_DAYS,
        dailyCheckTime: '09:00',
        quietFrom: null,
        quietUntil: null,
        spreadAcrossDay: false,
        catchUp: true,
        paused: false,
        nextCheckAt: null,
        pagesDueToday: 0
      }
      return schedule
    }
  }
}
