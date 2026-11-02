import type { AskAnswer } from '@shared/ipc'
import { askQuestion } from '../ask/answer'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { toContext } from '../handlers/context'
import { listProducts, replaceProductCatalog, type ProductCatalog } from '../storage/products'
import { createStructureRuntime } from '../structure/runtime'
import { claudePick } from '../structure/service-import'
import { SmokeError } from './errors'
import type { PageSmokeHookContext, SmokeHookResult } from './hook-context'
import { step } from './live'

/**
 * Live smoke routes for package P8 (Docs/PROMPT-AUDIT.md): `--assist ask` and
 * `--assist structure.import`. Both run after the page smoke on its temp project and
 * make no SerpApi search of their own.
 *
 * Both save a product catalog first when the project has none (what Fill from my
 * website would save for TextBolt).
 * - `ask` asks {@link ASK_SMOKE_QUESTIONS} through the real `askQuestion` and checks
 *   each answer's filters and counts.
 * - `structure.import` syncs the site's sitemaps (real fetches, no search) and runs
 *   Claude's pick; every picked id must be a page from the list.
 */

/** Questions a TextBolt marketer asks, each with what its filters must hold. */
export const ASK_SMOKE_QUESTIONS: readonly AskSmokeQuestion[] = [
  {
    question: 'Which prompts lost a citation to simpletexting?',
    expect: (answer) =>
      answer.filters.citedDomain === 'simpletexting.com' &&
      (answer.filters.movements ?? []).includes('lost')
  },
  {
    question: 'Which pages lost the AI Overview this week?',
    expect: (answer) => (answer.filters.movements ?? []).includes('lost')
  },
  {
    question: 'Where does Textmagic beat us?',
    expect: (answer) =>
      answer.filters.citedDomain === 'textmagic.com' &&
      !(answer.filters.statuses ?? ['page_cited']).includes('page_cited')
  },
  {
    question: 'What should I fix first for email to SMS?',
    expect: (answer) =>
      (answer.filters.pageIds !== null || answer.filters.text !== null) &&
      !(answer.filters.statuses ?? ['page_cited']).includes('page_cited')
  },
  {
    question: 'Which comparison prompts are we missing in the US?',
    expect: (answer) =>
      (answer.filters.intentStages ?? []).includes('comparison') &&
      answer.filters.marketIds !== null
  },
  {
    question: 'Who gets cited instead of us?',
    expect: (answer) => !(answer.filters.statuses ?? ['page_cited']).includes('page_cited')
  }
]

export interface AskSmokeQuestion {
  question: string
  expect: (answer: AskAnswer) => boolean
}

/** TextBolt's products and competitors, as Fill from my website saves them. */
export const TEXTBOLT_SMOKE_CATALOG: ProductCatalog = {
  products: [
    {
      id: 'prod-email-sms',
      name: 'Email to SMS',
      job: 'send text messages from email, alerts and monitoring tools',
      buyer: 'IT, facilities and operations teams without a developer',
      evidencePath: '/solutions/email-to-text-service/'
    },
    {
      id: 'prod-alerts',
      name: 'Text alert service',
      job: 'send mass text alerts to staff and customers',
      buyer: 'small businesses, schools and field teams',
      evidencePath: '/solutions/text-alert-service/'
    },
    {
      id: 'prod-text-email',
      name: 'Text to email',
      job: 'receive replies and inbound texts as email',
      buyer: 'support and office teams that live in their inbox',
      evidencePath: '/solutions/text-to-email-service/'
    }
  ],
  competitors: [
    competitor('Textmagic', 'textmagic.com', 'prod-email-sms', 'direct'),
    competitor('Twilio', 'twilio.com', 'prod-email-sms', 'partial'),
    competitor('SMS Gateway Center', 'smsgatewaycenter.com', 'prod-email-sms', 'direct'),
    competitor('SimpleTexting', 'simpletexting.com', 'prod-alerts', 'direct'),
    competitor('EZ Texting', 'eztexting.com', 'prod-alerts', 'direct'),
    competitor('Textmagic', 'textmagic.com', 'prod-alerts', 'partial'),
    competitor('Zapier', 'zapier.com', 'prod-text-email', 'partial')
  ]
}

function competitor(
  name: string,
  domain: string,
  productId: string,
  tier: 'direct' | 'partial'
): ProductCatalog['competitors'][number] {
  return { name, domain, productId, tier, startingPrice: null, sources: [] }
}

/** `--assist ask` and `--assist structure.import`. */
export async function runP8Smoke(
  context: PageSmokeHookContext,
  route: 'ask' | 'structure.import'
): Promise<SmokeHookResult> {
  const host = smokeHost(context)
  seedCatalog(context)
  try {
    if (route === 'ask') {
      const lines = await runAskQuestions(host, context.projectId, ASK_SMOKE_QUESTIONS, (line) =>
        context.io.stdout(line)
      )
      return { ran: true, detail: lines }
    }
    const detail = await step(context.push, context.secrets, 'structure.import', async () => {
      const picked = await runStructurePick(host, context.projectId, (line) =>
        context.io.stdout(line)
      )
      return picked
    })
    return { ran: true, detail }
  } finally {
    host.email.close()
  }
}

/**
 * Asks each question on the project and prints the filters, the answer and how long
 * it took. Throws when an answer misses its pass mark, after printing every answer.
 */
export async function runAskQuestions(
  host: EngineHost,
  projectId: string,
  questions: readonly AskSmokeQuestion[],
  print: (line: string) => void
): Promise<string> {
  const failed: string[] = []
  for (const item of questions) {
    const started = Date.now()
    const answer = await askQuestion(host, { projectId, question: item.question })
    const ms = Date.now() - started
    const ok = item.expect(answer) && countsAdd(answer)
    if (!ok) failed.push(item.question)
    print(`ask ${ok ? 'ok' : 'fail'} ${ms}ms Q: ${item.question}`)
    print(`  filters ${JSON.stringify(compactFilters(answer))}`)
    print(`  answer  ${answer.answer}`)
    if (answer.notCovered !== null) print(`  note    ${answer.notCovered}`)
  }
  if (failed.length > 0) {
    throw new SmokeError(`Ask CiteFox missed the pass mark for: ${failed.join(' | ')}`)
  }
  return `asked ${questions.length}`
}

/** Syncs the sitemaps, runs Claude's pick and checks every id is a listed page. */
export async function runStructurePick(
  host: EngineHost,
  projectId: string,
  print: (line: string) => void
): Promise<string> {
  const runtime = createStructureRuntime(host, { reread: async () => undefined })
  await runtime.sync(projectId, 'manual', { url: null })
  const paths = await withProject(host, projectId, 'smoke:structure', (opened) => {
    const rows = opened.db
      .prepare<[], { id: string; url: string }>(`SELECT id, url FROM pages WHERE url IS NOT NULL`)
      .all()
    return new Map(rows.map((row) => [row.id, new URL(row.url).pathname]))
  })
  const started = Date.now()
  const pick = await claudePick(runtime, { projectId, instruction: null })
  const ms = Date.now() - started
  const unknown = pick.pageIds.filter((id) => !paths.has(id))
  print(`structure.import ${ms}ms picked=${pick.pageIds.length} of ${paths.size} pages`)
  for (const reason of pick.reasons) print(`  reason  ${reason}`)
  print(`  picks   ${pick.pageIds.map((id) => paths.get(id) ?? id).join(' ')}`)
  if (unknown.length > 0) throw new SmokeError(`Claude picked ${unknown.length} unknown ids.`)
  if (pick.pageIds.length === 0) throw new SmokeError('Claude picked no page.')
  return `picked=${pick.pageIds.length} of ${paths.size}`
}

/** The filters with the unset ones left out, so a line stays readable. */
function compactFilters(answer: AskAnswer): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(answer.filters)) {
    if (value !== null) out[key] = value
  }
  out.total = answer.total
  out.searched = answer.searched
  return out
}

/** The answer's counts are the query's: never more matches than rows searched. */
function countsAdd(answer: AskAnswer): boolean {
  return answer.total <= answer.searched && answer.rows.length <= answer.total
}

function seedCatalog(context: PageSmokeHookContext): void {
  const db = context.setup.projectDb
  if (listProducts(db).length > 0) return
  replaceProductCatalog(db, TEXTBOLT_SMOKE_CATALOG)
}

/** An engine host over the smoke's storage, keys and Claude provider. */
function smokeHost(context: PageSmokeHookContext): EngineHost {
  return toContext({
    appInfo: () => ({ name: 'CiteFox', version: 'smoke' }),
    storage: context.storage,
    secrets: context.setup.secretStore,
    logger: context.setup.logger,
    http: context.setup.transport,
    claudeCommand: {
      run: () => Promise.reject(new SmokeError('The smoke runs Claude through its provider.'))
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => context.secrets,
    now: context.clock,
    claude: context.setup.provider
  })
}
