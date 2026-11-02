import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  CheckJob,
  CreateProjectRequest,
  IpcEventChannel,
  SiteStartPlan,
  StartProgress
} from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import type { CheckRequest } from '../engine/checks/prepare'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { HttpRequest, HttpTransport } from '../providers/http'
import { createMapTransport, fixtureDns } from '../structure/fixture-transport'
import { textboltSitemapFixture } from '../structure/fixtures/textbolt-sitemaps'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import { getProject } from '../storage/records'
import { topicFixtureReply } from '../topics/fixture-replies'
import { cleanupHarness, harness, routingHttp } from './test-harness'

afterEach(cleanupHarness)
vi.setConfig({ testTimeout: 30_000 })

const PROJECT: CreateProjectRequest = {
  name: 'TextBolt',
  domain: 'textbolt.com',
  includeSubdomains: false,
  brandNames: ['TextBolt'],
  competitors: ['simpletexting.com'],
  clientName: null,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop'
}

const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), 'src/main/assist/fixtures/start.firstPages.json'), 'utf8')
) as unknown

const SITE: Record<string, string> = {
  'https://textbolt.com/': '# Email to text for business alerts\n## Send alerts from Gmail',
  'https://textbolt.com/pricing': '# Pricing\n## Plans for small teams',
  'https://textbolt.com/faq': '# FAQ\n## What happens when a carrier gateway shuts down?',
  'https://textbolt.com/features/scheduled-texts/': '# Scheduled texts\n## Send later from Gmail'
}

interface Gate {
  /** First prompt line to hold, e.g. `Template: topic_buyer_profile.md`. */
  line: string
  reached: Promise<void>
  release: () => void
}

function gate(line: string): Gate {
  let reachedResolve: () => void = () => undefined
  let release: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    reachedResolve = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const held: Gate = { line, reached, release }
  ;(held as Gate & { wait: Promise<void>; hit: () => void }).wait = released
  ;(held as Gate & { wait: Promise<void>; hit: () => void }).hit = reachedResolve
  return held
}

function claude(
  options: { fail?: boolean; gates?: Gate[] } = {}
): ClaudeProvider & { prompts: string[] } {
  const prompts: string[] = []
  return {
    id: 'claude-code',
    prompts,
    async complete(request): Promise<ClaudeCompletion> {
      prompts.push(request.prompt)
      const first = request.prompt.split('\n', 1)[0] ?? ''
      const held = options.gates?.find((entry) => entry.line === first) as
        (Gate & { wait: Promise<void>; hit: () => void }) | undefined
      if (held) {
        held.hit()
        await held.wait
      }
      if (options.fail) throw new Error('Claude Code is not signed in')
      const json = first.startsWith('Assist: start.firstPages')
        ? FIXTURE
        : first.startsWith('Template: topic_journey_questions')
          ? pagerDutyFirst(topicFixtureReply(request.prompt))
          : topicFixtureReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

/** Puts the Compare question that names PagerDuty first, so a 10-question draft keeps it. */
function pagerDutyFirst(reply: unknown): unknown {
  const value = reply as { questions: { stage: string; text: string }[] }
  const named = value.questions.filter((question) => question.text.includes('PagerDuty'))
  const rest = value.questions.filter((question) => !question.text.includes('PagerDuty'))
  return { ...value, questions: [...named, ...rest] }
}

/** Fails on any SerpApi request: nothing before the first check searches. */
function noSearchHttp(requests: string[]): HttpTransport {
  const inner = routingHttp()
  return {
    request(request: HttpRequest) {
      requests.push(request.url)
      if (request.url.includes('serpapi.com/search')) throw new Error('SerpApi was called')
      return inner.request(request)
    }
  }
}

function fakeChecks(started: CheckRequest[]): CheckEngine {
  return {
    start: async (request: CheckRequest) => {
      started.push(request)
      return {
        id: `job-${started.length}`,
        projectId: request.projectId,
        status: 'running',
        message: null,
        nextStep: null
      } as unknown as CheckJob
    }
  } as unknown as CheckEngine
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function setup(
  provider: ClaudeProvider,
  withSitemap = true,
  slow?: { inFlight: number; most: number }
) {
  const events: StartProgress[] = []
  const requests: string[] = []
  const reads: string[] = []
  const started: CheckRequest[] = []
  const files = withSitemap ? textboltSitemapFixture('base').files : new Map<string, string>()
  const h = harness({
    claude: provider,
    http: noSearchHttp(requests),
    checkEngine: fakeChecks(started),
    sitemapFetch: { http: createMapTransport(files), dns: fixtureDns },
    rereadPage: async () => undefined,
    readWebsitePage: async (url: string) => {
      reads.push(url)
      if (slow !== undefined) {
        slow.inFlight += 1
        slow.most = Math.max(slow.most, slow.inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        slow.inFlight -= 1
      }
      const text = SITE[url]
      return text === undefined ? null : { title: 'TextBolt', text }
    },
    emit: (channel: IpcEventChannel, payload: unknown) => {
      if (channel === 'start:changed') events.push(payload as StartProgress)
    }
  })
  const project = await h.handlers['projects:create'](PROJECT)
  // What Fill from my website saves (P2: rivals come from the project, never from the
  // page pick): a competitor the fixture questions name, switch-from and integrations.
  const record = getProject(h.storage.db, project.id)
  if (record === null) throw new Error('no project')
  const db = openProjectDatabase(h.storage.paths.projectsDirectory, record.slug)
  try {
    const profile = readProjectProfile(db)
    if (profile === null) throw new Error('no profile')
    updateProjectProfile(db, {
      ...profile,
      competitors: ['simpletexting.com', 'PagerDuty'],
      switchingFrom: ['AT&T email-to-text gateway', 'Verizon vtext.com'],
      integrations: ['WIN-911']
    })
  } finally {
    closeProjectDatabase(db)
  }
  return { ...h, projectId: project.id, events, requests, reads, started }
}

function last(events: readonly StartProgress[]): StartProgress {
  const event = events.at(-1)
  if (event === undefined) throw new Error('no progress')
  return event
}

describe('start:homework (the autopilot)', () => {
  test('reads, groups, picks, sorts rivals, drafts profile and questions, saves the plan', async () => {
    const provider = claude()
    const ctx = await setup(provider)
    expect(await ctx.handlers['start:get']({ projectId: ctx.projectId })).toBeNull()

    const plan = await ctx.handlers['start:homework']({ projectId: ctx.projectId })

    expect(plan.pageCount).toBe(textboltSitemapFixture('base').pageUrls.length)
    expect(plan.sections[0]).toMatchObject({ key: '/blog/', label: 'Blog' })
    expect(plan.source).toBe('claude')
    // Code ranks the pages (P2): money pages and the competitor's alternatives page first.
    expect(plan.pages.slice(0, 3).map((page) => page.path)).toEqual(
      expect.arrayContaining(['/pricing/', '/alternatives/simpletexting-alternatives/'])
    )
    expect(plan.pages.find((page) => page.path === '/pricing/')?.reason).toMatch(/email-to-text/u)
    expect(plan.recommendedUrls).toHaveLength(3)
    expect(
      plan.rivals.filter((rival) => rival.kind === 'partner').map((rival) => rival.name)
    ).toEqual(['WIN-911'])
    expect(plan.rivals.filter((rival) => rival.kind === 'switch_from')).toHaveLength(2)
    // The topics come from seed discover, ranked by code; the draft is the best one.
    expect(plan.topics).toHaveLength(2)
    expect(plan.topic?.seed).toBe(plan.topics[0]?.seed)
    expect(plan.buyers.segments.length).toBeGreaterThan(0)
    expect(plan.questions.length).toBeGreaterThan(5)
    expect(plan.sections.some((section) => section.likely > 0)).toBe(true)

    // Claude: the pick and the seeds side by side, then the profile, the questions, the
    // page match. No search.
    const firstLines = provider.prompts.map((prompt) => prompt.split('\n', 1)[0])
    expect(firstLines.slice(0, 2)).toEqual(
      expect.arrayContaining(['Assist: start.firstPages', 'Template: topic_seed_discover.md'])
    )
    expect(firstLines).toContain('Template: topic_buyer_profile.md')
    expect(firstLines).toContain('Template: topic_journey_questions.md')
    expect(ctx.requests.some((url) => url.includes('serpapi.com'))).toBe(false)

    // Live snapshots: every step, with what each found, ending done.
    const done = last(ctx.events)
    expect(done.phase).toBe('done')
    expect(done.items.every((item) => item.state === 'ok' || item.state === 'warning')).toBe(true)
    expect(done.items.find((item) => item.id === 'sitemap')?.detail).toMatch(/pages/u)
    expect(done.known.rivals.length).toBeGreaterThan(0)
    expect(ctx.events.some((event) => event.items.some((item) => item.state === 'running'))).toBe(
      true
    )

    // Saved and reused without new Claude calls.
    const calls = provider.prompts.length
    const again = await ctx.handlers['start:homework']({ projectId: ctx.projectId })
    expect(again.builtAt).toBe(plan.builtAt)
    expect(provider.prompts).toHaveLength(calls)
    const status = await ctx.handlers['start:status']({ projectId: ctx.projectId })
    expect(status).toMatchObject({ hasPlan: true, empty: true, checkStarted: false })
  })

  test('without Claude: pages from address rules, no topic, a plain message', async () => {
    const ctx = await setup(claude({ fail: true }))
    const plan = await ctx.handlers['start:homework']({ projectId: ctx.projectId })
    expect(plan.source).toBe('rules')
    expect(plan.topic).toBeNull()
    expect(plan.pages.map((page) => page.kind)).toEqual(
      expect.arrayContaining(['pricing', 'alternatives'])
    )
    // The ranking facts stand in for Claude's evidence.
    expect(plan.pages.find((page) => page.kind === 'pricing')?.evidence).toBe('Pricing page.')
    expect(plan.message).toMatch(/CiteFox AI could not be reached/u)
    expect(last(ctx.events).items.find((item) => item.id === 'questions')?.state).toBe('warning')
  })

  test('reads the key pages two at a time and keeps them in order', async () => {
    const slow = { inFlight: 0, most: 0 }
    const ctx = await setup(claude(), true, slow)
    const plan = await ctx.handlers['start:homework']({ projectId: ctx.projectId })
    expect(plan.topic).not.toBeNull()
    expect(slow.most).toBe(2)
    const keyPages = last(ctx.events).items.find((item) => item.id === 'key_pages')
    expect(keyPages?.state).toBe('ok')
    // The usual paths are asked for in their order, after the homepage.
    const usual = ['/pricing', '/features', '/faq', '/about', '/use-cases'].map(
      (path) => `https://textbolt.com${path}`
    )
    expect(ctx.reads.filter((url) => usual.includes(url)).slice(0, 2)).toEqual(usual.slice(0, 2))
  })

  test('Pause stops after the current step and Resume finishes', async () => {
    const held = gate('Assist: start.firstPages')
    const provider = claude({ gates: [held] })
    const ctx = await setup(provider)
    const run = ctx.handlers['start:homework']({ projectId: ctx.projectId })
    await held.reached
    const paused = await ctx.handlers['start:stop']({ projectId: ctx.projectId })
    expect(paused?.phase).toBe('running')
    held.release()
    await expect(run).rejects.toThrow(/paused/u)
    expect(last(ctx.events).phase).toBe('stopped')
    const plan = await ctx.handlers['start:homework']({ projectId: ctx.projectId })
    expect(plan.topic).not.toBeNull()
  })
})

describe('edits along the way', () => {
  test('a rival removed and a page added mid-run reach the steps still to run', async () => {
    const held = gate('Assist: start.firstPages')
    const provider = claude({ gates: [held] })
    const ctx = await setup(provider)
    const run = ctx.handlers['start:homework']({ projectId: ctx.projectId })
    await held.reached

    const removed = await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'rival', op: 'remove', name: 'PagerDuty' }
    })
    expect(removed.record.summary).toBe('Removed PagerDuty')
    expect(removed.progress?.known.rivals.map((rival) => rival.name)).not.toContain('PagerDuty')
    const added = await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'page', op: 'add', url: '/features/scheduled-texts/' }
    })
    expect(added.effect).toBe('Read /features/scheduled-texts/.')
    expect(ctx.reads).toContain('https://textbolt.com/features/scheduled-texts/')
    held.release()
    const plan: SiteStartPlan = await run

    // The profile was written with the edited rivals (PagerDuty no longer a competitor).
    const profilePrompt = provider.prompts.find((prompt) =>
      prompt.startsWith('Template: topic_buyer_profile.md')
    )
    expect(profilePrompt).toMatch(/Partners and integrations \(never competitors\): WIN-911/u)
    expect(profilePrompt).not.toMatch(/Competitors[^.]*PagerDuty/u)
    // The question that named PagerDuty was rewritten without it.
    expect(plan.questions.some((question) => /PagerDuty/u.test(question.text))).toBe(false)
    expect(plan.rivals.map((rival) => rival.name)).not.toContain('PagerDuty')
    expect(plan.pages.map((page) => page.path)).toContain('/features/scheduled-texts/')
    const { edits } = await ctx.handlers['start:edits']({ projectId: ctx.projectId })
    expect(edits.some((edit) => edit.system && edit.parentId === removed.record.id)).toBe(true)

    // Undo brings PagerDuty back, with the question it was named in.
    const undone = await ctx.handlers['start:undo']({
      projectId: ctx.projectId,
      editId: removed.record.id
    })
    expect(undone.plan?.rivals.map((rival) => rival.name)).toContain('PagerDuty')
    expect(undone.plan?.questions.some((question) => /PagerDuty/u.test(question.text))).toBe(true)
  })

  test('edits after the run change the plan, survive a reload, and reach the first check', async () => {
    const ctx = await setup(claude())
    const plan = await ctx.handlers['start:homework']({ projectId: ctx.projectId })
    const [first, second] = plan.questions
    if (first === undefined || second === undefined) throw new Error('no questions')
    await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'question', op: 'remove', id: first.id }
    })
    await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: {
        kind: 'question',
        op: 'edit',
        id: second.id,
        text: 'How do we text the night shift from Outlook?'
      }
    })
    await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'rival', op: 'move', name: 'PagerDuty', rivalKind: 'partner' }
    })
    await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'segment', op: 'add', text: 'Schools' }
    })
    const reloaded = await ctx.handlers['start:get']({ projectId: ctx.projectId })
    expect(reloaded?.questions.map((question) => question.id)).not.toContain(first.id)
    expect(reloaded?.questions.find((question) => question.id === second.id)?.text).toBe(
      'How do we text the night shift from Outlook?'
    )
    expect(reloaded?.rivals.find((rival) => rival.name === 'PagerDuty')?.kind).toBe('partner')
    expect(reloaded?.buyers.segments).toContain('Schools')
    expect(reloaded?.questions.length).toBe(plan.questions.length - 1)

    const begun = await ctx.handlers['start:begin']({
      projectId: ctx.projectId,
      targetUrls: plan.recommendedUrls
    })
    expect(ctx.started).toHaveLength(1)
    const results = await ctx.handlers['topics:results']({
      projectId: ctx.projectId,
      topicId: begun.topicId,
      marketId: null,
      runId: null
    })
    const texts = results.rows.filter((row) => row.kind === 'question').map((row) => row.text)
    expect(texts).toContain('How do we text the night shift from Outlook?')
    expect(texts).not.toContain(first.text)
    const status = await ctx.handlers['start:status']({ projectId: ctx.projectId })
    expect(status).toMatchObject({ topicId: begun.topicId, checkStarted: true, empty: false })
  })

  test('rejects edits off the site and bad requests', async () => {
    const ctx = await setup(claude())
    await expect(
      ctx.handlers['start:edit']({
        projectId: ctx.projectId,
        edit: { kind: 'page', op: 'add', url: 'https://other.com/x' }
      })
    ).rejects.toThrow(/textbolt\.com/u)
    await expect(
      ctx.handlers['start:edit']({ projectId: ctx.projectId, edit: { kind: 'nope' } as never })
    ).rejects.toThrow('start:edit')
    await expect(
      ctx.handlers['start:undo']({ projectId: ctx.projectId, editId: 'x' })
    ).rejects.toThrow('start:undo')
    await expect(ctx.handlers['start:homework']({ projectId: '' })).rejects.toThrow(
      'start:homework'
    )
  })
})

describe('a page added while the profile is written', () => {
  test('joins the saved plan', async () => {
    const held = gate('Template: topic_buyer_profile.md')
    const ctx = await setup(claude({ gates: [held] }))
    const run = ctx.handlers['start:homework']({ projectId: ctx.projectId })
    await held.reached
    await ctx.handlers['start:edit']({
      projectId: ctx.projectId,
      edit: { kind: 'page', op: 'add', url: 'https://textbolt.com/features/scheduled-texts/' }
    })
    held.release()
    await run
    const plan = await ctx.handlers['start:get']({ projectId: ctx.projectId })
    expect(plan?.pages.map((page) => page.path)).toContain('/features/scheduled-texts/')
  })
})

describe('start:suggestUrls', () => {
  test('lists sitemap pages for the Add page address box', async () => {
    const ctx = await setup(claude())
    await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    const result = await ctx.handlers['start:suggestUrls']({
      projectId: ctx.projectId,
      query: 'pric',
      limit: 3
    })
    expect(result.suggestions[0]).toMatchObject({ url: 'https://textbolt.com/pricing/' })
  })
})
