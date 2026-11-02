import type { CreateTopicsRequest, HelpFillResult, HelpFillRow } from '@shared/ipc'
import type { SetupHelpSource } from './source'

const row = (id: string, section: string, values: Record<string, string>): HelpFillRow => ({
  id,
  section,
  values
})

/** What main's reader returns for a full five-section ChatGPT answer about textbolt.com. */
export const SETUP_RESULT: HelpFillResult = {
  kind: 'project',
  rows: [
    row('row-1', 'products', {
      name: 'Email to SMS',
      url: '/email-to-text/',
      job: 'Texts from email'
    }),
    row('row-2', 'products', { name: 'Text alerts', url: '', job: 'Alert a crew by text' }),
    row('row-3', 'buyers', {
      who: 'Office managers',
      problem: 'Staff miss urgent emails',
      trigger: 'A carrier gateway shut down',
      product: 'Email to SMS'
    }),
    row('row-4', 'buyers', {
      who: 'IT and ops teams',
      problem: 'Alerts go unseen at night',
      trigger: 'An outage',
      product: 'text alerts'
    }),
    row('row-5', 'competitors', {
      name: 'Twilio',
      domain: 'twilio.com',
      competes_with: 'Text alerts'
    }),
    row('row-6', 'competitors', {
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      competes_with: 'Email to SMS'
    }),
    row('row-7', 'competitors', { name: 'Some rival', domain: '', competes_with: '' }),
    row('row-8', 'markets', { country: 'US', language: 'en', city: '' }),
    row('row-9', 'markets', { country: 'CA', language: 'en', city: 'Toronto' }),
    row('row-10', 'questions', {
      question: 'My carrier stopped email to text, what now?',
      stage: 'problem',
      product: 'Email to SMS'
    }),
    row('row-11', 'questions', {
      question: 'How do I text the night shift when an alarm emails?',
      stage: 'options',
      product: 'Text alerts'
    }),
    row('row-12', 'questions', {
      question: 'Which tools send texts without an app?',
      stage: '',
      product: 'Something else'
    })
  ],
  setAside: [
    row('row-13', 'questions', { question: 'Is TextBolt cheaper?', stage: 'compare', product: '' })
  ],
  counts: { read: 14, tracked: 0, repeats: 1, setAside: 1, ready: 12 },
  noun: ['item', 'items'],
  brand: 'TextBolt',
  warnings: []
}

export interface FakeSetupSource extends SetupHelpSource {
  prompts: { domain: string; brandNames: readonly string[] }[]
  reads: string[]
  topics: CreateTopicsRequest[]
}

export function fakeSetupSource(options: { available?: boolean } = {}): FakeSetupSource {
  const available = options.available ?? true
  const prompts: FakeSetupSource['prompts'] = []
  const reads: string[] = []
  const topics: CreateTopicsRequest[] = []
  return {
    prompts,
    reads,
    topics,
    'helpfill:setupEstimate': async () => ({
      kind: 'project',
      available,
      calls: 5,
      costText: available ? 'Up to 5 AI calls · about $0.05' : 'Up to 5 AI calls',
      reason: available ? null : 'Needs CiteFox AI connected.'
    }),
    'helpfill:setupPrompt': async ({ site }) => {
      prompts.push({ domain: site.domain, brandNames: site.brandNames })
      return {
        kind: 'project',
        prompt: `You help set up AI-search tracking for ${site.domain}.\n\n### PRODUCTS\nname,url,job`,
        columns: ['name', 'url', 'job'],
        tracked: 0
      }
    },
    'helpfill:setupRead': async ({ text }) => {
      reads.push(text)
      return SETUP_RESULT
    },
    'topics:createTopics': async (request) => {
      topics.push(request)
      return { topicIds: request.topics.map((_, index) => `t${index}`), questions: 0, message: '' }
    }
  }
}
