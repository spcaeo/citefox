import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { AssistProgress } from '@shared/ipc'
import {
  readFixture,
  request,
  seedAssistProject,
  type AssistSeed
} from '../assist/assist.test-helper'
import { ensureShippedAssists } from '../assist/definitions'
import { runWithProgress } from '../assist/progress'
import { runAssist } from '../assist/run'
import { PRODUCT_RULE } from '../engine/site-outline'
import { createLogger } from '../logging/logger'
import { textboltContext } from '../onboarding/sections/test-context.test-helper'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage } from '../storage/app-storage'
import { createIpcHandlers, type IpcHandlerDeps } from './index'

/**
 * Owner feedback #1: "Fill from my website" pushes one live step per real
 * boundary (each page read, the Claude call with its connection and model,
 * the check of the answer, the domain check, the result count), in order.
 */

ensureShippedAssists()

const directories: string[] = []
const closers: (() => void)[] = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Batch 2 row 5: three focused calls, each answered by its assist id. */
const SITE = {
  summary: 'TextBolt sells an email-to-text gateway to small US businesses.',
  brands: [
    { name: 'TextBolt', reason: 'The home page names it.' },
    { name: 'Text Bolt', reason: 'The pricing page spells it apart.' }
  ],
  products: [
    {
      name: 'Email-to-SMS gateway',
      job: 'Turns emails into texts.',
      buyer: 'Small US businesses',
      evidence: { path: '/', quote: 'Email to text for business alerts.' }
    }
  ],
  comparedWith: ['SimpleTexting'],
  suggestedMarket: { country: 'US', language: 'en', location: null, reason: 'Prices in dollars.' }
}

const SWITCHING = { switchingFrom: [], integrations: [] }

const COMPETITORS = {
  direct: [
    {
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      why: 'Business texting.',
      startingPrice: '$39/mo',
      sources: [{ url: 'https://textbolt.com/compare', biased: true }]
    }
  ],
  partial: [
    {
      name: 'Text-Em-All',
      domain: 'textemall.com',
      why: 'Mass text alerts.',
      startingPrice: null,
      sources: []
    }
  ]
}

type Replies = Record<string, unknown[]>

const REPLIES = (): Replies => ({
  'project.fillSiteRead': [SITE],
  'project.fillSwitching': [SWITCHING],
  'project.productCompetitors': [COMPETITORS]
})

const PAGES: Readonly<Record<string, { title: string; text: string }>> = {
  'https://textbolt.com/': { title: 'Home', text: 'Email to text for business alerts.' },
  'https://textbolt.com/pricing': { title: 'Pricing', text: 'Plans start at 29 dollars a month.' },
  'https://textbolt.com/compare': { title: 'Compare', text: 'TextBolt and SimpleTexting.' }
}

function claudeReplying(replies: Replies): ClaudeProvider & { prompts: string[] } {
  const prompts: string[] = []
  return {
    id: 'claude-code',
    prompts,
    async complete(input): Promise<ClaudeCompletion> {
      prompts.push(input.prompt)
      const id = /^Assist: (\S+)/u.exec(input.prompt)?.[1] ?? ''
      const queue = replies[id] ?? [null]
      const json = queue.length > 1 ? queue.shift() : queue[0]
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json: json ?? null,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 12_000,
        model: input.model ?? null,
        resolvedModel: 'claude-sonnet-4-5',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 10, outputTokens: 20 }
      }
    }
  }
}

function handlersWith(overrides: Partial<IpcHandlerDeps>): ReturnType<typeof createIpcHandlers> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-fill-progress-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  let sequence = 0
  return createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger: createLogger({ write: () => undefined }),
    http: { request: async () => ({ status: 500, body: '' }) },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    emitPageReadProgress: () => undefined,
    emitFillProgress: () => undefined,
    knownSecrets: () => registry.list(),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    pageDns: {
      async lookup(hostname) {
        if (hostname === 'textemall.com') throw new Error('ENOTFOUND')
        return ['93.184.216.34']
      }
    },
    readWebsitePage: async (url) => PAGES[url] ?? null,
    ...overrides
  })
}

async function fillWithProgress(
  handlers: ReturnType<typeof createIpcHandlers>
): Promise<{ events: AssistProgress[]; result: Awaited<ReturnType<typeof run>> }> {
  const events: AssistProgress[] = []
  const run = (): ReturnType<(typeof handlers)['projects:fillFromWebsite']> =>
    handlers['projects:fillFromWebsite']({ projectId: null, domain: 'textbolt.com' })
  const result = await runWithProgress(
    { channel: 'projects:fillFromWebsite', scope: 'textbolt.com', emit: (e) => events.push(e) },
    run
  )
  return { events, result }
}

/** The final state of each step, in the order the steps started. */
function finals(events: readonly AssistProgress[]): string[] {
  const order: string[] = []
  const last = new Map<string, AssistProgress>()
  for (const event of events) {
    if (!last.has(event.stepId)) order.push(event.stepId)
    last.set(event.stepId, event)
  }
  return order.map((id) => {
    const event = last.get(id)
    return `${event?.state} · ${event?.label}${event?.detail ? ` · ${event.detail}` : ''}`
  })
}

describe('Fill from my website progress', () => {
  test('pushes every page read, the Claude call, the checks and the count in order', async () => {
    const handlers = handlersWith({ claude: claudeReplying(REPLIES()) })
    const { events, result } = await fillWithProgress(handlers)
    expect(result.brands).toHaveLength(2)
    expect(finals(events)).toEqual([
      'done · Reading textbolt.com · Read · 6 words',
      'done · Reading /pricing · Read · 7 words',
      'skipped · Reading /about · Not found or not readable · skipped',
      'done · Reading /compare · Read · 3 words',
      'done · Asking CiteFox AI to read what your site sells and its brand names · Using 3 of 4 pages · no searches',
      'done · Asking CiteFox AI to find what buyers switch from and the tools used with you · Using 3 of 4 pages · no searches',
      'done · Checking the answer',
      'done · Checking the answer',
      'done · Searching the web for competitors · Email-to-SMS gateway · For buyers in United States (English) · web search on for this step only',
      'done · Checking the answer',
      'done · Checking competitor domains · 2 competitors · 1 domain verified',
      'done · 5 suggestions ready · Nothing is saved until you add it'
    ])
    // Each step starts running before it ends, and every event names the run.
    expect(events[0]).toMatchObject({ state: 'running', label: 'Reading textbolt.com' })
    expect(new Set(events.map((event) => event.runId)).size).toBe(1)
    expect(events.every((event) => event.channel === 'projects:fillFromWebsite')).toBe(true)
    expect(events.every((event) => event.scope === 'textbolt.com')).toBe(true)
    const claude = events.filter((event) => event.kind === 'claude')
    expect(claude[0]?.claude).toMatchObject({
      connection: 'claude-code',
      connectionText: 'CiteFox AI · on your plan'
    })
    expect(claude.at(-1)?.claude?.model).toBe('claude-sonnet-4-5')
    expect(claude.at(-1)?.endedAt).not.toBeNull()
  })

  test('names the retry when the first answer does not match', async () => {
    const handlers = handlersWith({
      claude: claudeReplying({ ...REPLIES(), 'project.fillSiteRead': [{ nope: true }, SITE] })
    })
    const { events } = await fillWithProgress(handlers)
    const steps = finals(events).filter((line) => /what your site sells|shape/u.test(line))
    expect(steps).toEqual([
      'done · Asking CiteFox AI to read what your site sells and its brand names · Using 3 of 4 pages · no searches',
      'failed · Checking the answer · It did not match the expected shape · asking again',
      'done · Asking CiteFox AI again to read what your site sells and its brand names · Using 3 of 4 pages · no searches'
    ])
  })

  test('a site that cannot be read ends with a failed step and no AI call', async () => {
    const claude = claudeReplying(REPLIES())
    const handlers = handlersWith({ claude, readWebsitePage: async () => null })
    const { events } = await fillWithProgress(handlers)
    expect(finals(events).at(-1)).toBe(
      'failed · Could not read the website · Check the domain and try again.'
    )
    expect(events.some((event) => event.kind === 'claude')).toBe(false)
    expect(claude.prompts).toHaveLength(0)
  })

  test('events carry no page text, prompt or reply', async () => {
    const handlers = handlersWith({ claude: claudeReplying(REPLIES()) })
    const { events } = await fillWithProgress(handlers)
    const joined = JSON.stringify(events)
    expect(joined).not.toContain('Plans start at 29 dollars')
    expect(joined).not.toContain('Suggest brands and competitors')
    expect(joined).not.toContain('The home page names it')
  })
})

describe("Fill from my website: the site's own offering pages", () => {
  const HOME = {
    title: 'TextBolt · Email to text',
    text: 'Email to text for business alerts.',
    anchors: [
      { text: 'Server monitoring alerts', url: 'https://textbolt.com/use-case/server-monitoring/' },
      { text: 'Send text from Gmail', url: 'https://textbolt.com/integration/gmail-to-text/' },
      { text: 'AT&T gateway alternative', url: 'https://textbolt.com/migration/att/' },
      { text: 'Blog', url: 'https://textbolt.com/blog/' },
      { text: 'Privacy', url: 'https://textbolt.com/legal/privacy-policy/' },
      { text: 'Log in', url: 'https://my.textbolt.com/login/' }
    ]
  }
  const SITE_PAGES: Readonly<Record<string, { title: string; text: string }>> = {
    ...PAGES,
    'https://textbolt.com/': HOME,
    'https://textbolt.com/use-case/server-monitoring/': {
      title: 'Server monitoring text alerts',
      text: 'Nagios and Zabbix alerts become texts.'
    },
    'https://textbolt.com/migration/att/': {
      title: 'AT&T email to text alternative',
      text: 'AT&T shut down its gateway.'
    }
  }

  test('reads the use-case, integration and migration pages the home page links to', async () => {
    const claude = claudeReplying(REPLIES())
    const read: string[] = []
    const handlers = handlersWith({
      claude,
      readWebsitePage: async (url) => {
        read.push(url)
        return SITE_PAGES[url] ?? null
      }
    })
    const { events, result } = await fillWithProgress(handlers)
    expect(read).toEqual([
      'https://textbolt.com/',
      'https://textbolt.com/pricing',
      'https://textbolt.com/about',
      'https://textbolt.com/compare',
      'https://textbolt.com/use-case/server-monitoring/',
      'https://textbolt.com/integration/gmail-to-text/',
      'https://textbolt.com/migration/att/'
    ])
    const lines = finals(events)
    expect(lines).toContain('done · Reading /use-case/server-monitoring · Read · 6 words')
    expect(lines).toContain(
      'skipped · Reading /integration/gmail-to-text · Not found or not readable · skipped'
    )
    expect(lines).toContain(
      'done · Asking CiteFox AI to read what your site sells and its brand names · Using 5 of 7 pages · no searches'
    )
    expect(result.pagesRead.at(-1)).toEqual({
      url: 'https://textbolt.com/migration/att/',
      role: 'page',
      ok: true
    })
    const prompt = claude.prompts.find((text) => text.startsWith('Assist: project.fillSiteRead'))
    expect(prompt).toContain(`- products: ${PRODUCT_RULE}`)
    expect(prompt).toContain(
      'Site menu (link text and path):\n- Server monitoring alerts: /use-case/server-monitoring/\n- Send text from Gmail: /integration/gmail-to-text/\n- AT&T gateway alternative: /migration/att/\n'
    )
    expect(prompt).not.toContain('/blog/')
    expect(prompt).toContain('/use-case/server-monitoring/: Server monitoring text alerts')
    expect(prompt).not.toContain('use cases of one product are one product')

    // The products section card then sees the same pages and menu, with no new read.
    const before = read.length
    const shown = await handlers['onboarding:sectionPrompt']({
      section: 'products',
      context: textboltContext(),
      mode: 'more',
      instruction: null,
      current: []
    })
    expect(read).toHaveLength(before)
    expect(shown.prompt).toContain(
      'Site paths (page titles or menu words; no other paths exist):\n- /: TextBolt · Email to text\n- /pricing: Pricing'
    )
    expect(shown.prompt).toContain('- /migration/att/: AT&T email to text alternative')
    // What the read found shows with the words that show it.
    expect(shown.prompt).toContain('What the pages say it sells:\n- Email-to-SMS gateway (/):')
  })
})

describe('Fill from my website: pages read side by side', () => {
  test('two pages of the site at once, finished in any order, kept in page order', async () => {
    const claude = claudeReplying(REPLIES())
    let inFlight = 0
    let most = 0
    const waiting: Array<() => void> = []
    const handlers = handlersWith({
      claude,
      readWebsitePage: async (url) => {
        inFlight += 1
        most = Math.max(most, inFlight)
        // The home page (and the site's page list, read when the home page has no links)
        // answers at once; the others wait to be let go, newest first.
        if (url !== 'https://textbolt.com/' && !/\/(?:llms\.txt|sitemap\.xml)$/u.test(url)) {
          await new Promise<void>((resolve) => waiting.push(resolve))
        }
        inFlight -= 1
        return PAGES[url] ?? null
      }
    })
    const filled = fillWithProgress(handlers)
    for (let turn = 0; turn < 200 && waiting.length < 2; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    // Pricing, about and compare are due: only two run on textbolt.com at once.
    expect(waiting).toHaveLength(2)
    while (waiting.length > 0) {
      waiting.pop()?.()
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    }
    const { result } = await filled
    expect(most).toBe(2)
    expect(result.pagesRead.map((page) => page.url)).toEqual([
      'https://textbolt.com/',
      'https://textbolt.com/pricing',
      'https://textbolt.com/about',
      'https://textbolt.com/compare'
    ])
    const prompt = claude.prompts.find((text) => text.startsWith('Assist: project.fillSiteRead'))
    const pricing = prompt?.indexOf('/pricing (pricing): Pricing') ?? -1
    const compare = prompt?.indexOf('/compare (compare): Compare') ?? -1
    expect(pricing).toBeGreaterThan(-1)
    expect(compare).toBeGreaterThan(pricing)
  })
})

describe('assist:run progress', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test('reads saved data, asks Claude, checks the answer and counts the suggestions', async () => {
    const events: AssistProgress[] = []
    seed.claude.queue.push(readFixture('page.promises'))
    const result = await runWithProgress(
      { channel: 'assist:run', scope: 'page.promises', emit: (e) => events.push(e) },
      () => runAssist(seed.host, request('page.promises'))
    )
    const count = result.items.length
    expect(finals(events)).toEqual([
      'done · Reading your saved data · No new searches',
      'done · Asking CiteFox AI to list what the page promises',
      'done · Checking the answer',
      `done · ${count} suggestions ready`
    ])
  })
})
