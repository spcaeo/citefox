import type {
  SiteStartPage,
  SiteStartPlan,
  StartBuyers,
  StartEditRecord,
  StartQuestion,
  StartRival,
  StartTopicDraft,
  TopicProgress
} from '@shared/ipc'
import type { TopicDraft } from '@shared/domain'
import { START_QUESTION_COUNT, START_RECOMMENDED_PAGES } from '@shared/site-start'
import { splitAcrossStages } from '@shared/topic-depth'
import { historyDatabases } from '../assist/run'
import { assistLabel, connectionOf, expectedSeconds } from '../assist/label'
import type { CheckEngine } from '../engine/checks/engine'
import type { EngineHost } from '../engine/host'
import { createLimiter } from '../engine/checks/check-pace'
import { normalizeUrl } from '../engine/checks/url'
import { withProject } from '../engine/project-db'
import { PAGE_READS_PER_SITE } from '../pipeline/read-pool'
import { readProjectProfile } from '../storage/project-profile'
import type { StructureRuntime } from '../structure/runtime'
import { currentProfilePoints } from '../topics/drafts'
import type { SiteRead } from '../topics/records'
import { createTopicsService, type TopicsService } from '../topics/service'
import { KEY_PAGE_PATHS, readOne, siteRoot } from '../topics/site'
import {
  annotateSections,
  pageKind,
  buildSections,
  pathOfUrl,
  shortlist,
  type StartPageRow
} from './candidates'
import { applyQuestionEdits } from '@shared/start-edits'
import { rewriteForRemovedRivals } from './begin'
import {
  draftQuestions,
  feedDraftBeforeProfile,
  feedProfileEdits,
  syncDraftQuestions
} from './edits'
import { firstPicks } from './first-picks'
import { START_ASSIST_ID } from './prompt'
import { countSitemaps, listStartPages, saveStartPlan } from './store'
import type { StartTracker } from './tracker'

/** Thrown between steps after `start:stop`. */
export class StartStopped extends Error {
  constructor() {
    super('Stopped')
    this.name = 'StartStopped'
  }
}

export interface AutopilotDeps {
  host: EngineHost
  rt: StructureRuntime
  checks: CheckEngine | null
}

/** What the autopilot asks the service between steps. */
export interface AutopilotHooks {
  /** The user's edits so far (stored; read fresh before each step that uses them). */
  edits: () => Promise<StartEditRecord[]>
  /** The topic draft being written, so a mid-run edit can reach it. */
  onDraft: (draftId: string) => void
}

const EXTRA_READS = 6
const EXPECTED_PICK_SECONDS = 25

/**
 * The guided autopilot (journey A): homepage, sitemap, sections, key pages; then the
 * pages and topics with the most to gain, ranked by code (Docs/PROMPT-AUDIT.md P2
 * item 4) with two Claude calls side by side (one explains the page picks, one writes
 * the seeds); rivals from the saved catalog; then a topic draft for the best seed's
 * product with its buyer profile, questions and page matches. Never a SerpApi search.
 * Saves the plan.
 */
export async function runAutopilot(
  deps: AutopilotDeps,
  projectId: string,
  force: boolean,
  tracker: StartTracker,
  stopped: () => boolean,
  hooks: AutopilotHooks
): Promise<SiteStartPlan> {
  const { host, rt } = deps
  const began = Date.now()
  const checkpoint = (): void => {
    if (stopped()) throw new StartStopped()
  }
  const project = await withProject(host, projectId, 'start:homework', (opened) => ({
    domain: opened.project.domain,
    profile: readProjectProfile(opened.db),
    hasPages: listStartPages(opened.db).length > 0
  }))
  const root = siteRoot(project.domain)
  // What the project already names shows (and can be edited) from the first second.
  tracker.setKnown({
    rivals: mergeRivals(project.profile?.competitors ?? [], [], {
      switchingFrom: project.profile?.switchingFrom ?? [],
      integrations: project.profile?.integrations ?? []
    })
  })
  const reads: SiteRead[] = []

  // 1. Homepage.
  tracker.start('home', root.replace(/^https:\/\//u, ''))
  const home = await withProject(host, projectId, 'start:homework', (opened) =>
    readOne(host, opened.db, `${root}/`, 'home', force)
  )
  reads.push(home)
  tracker.finish(
    'home',
    home.ok ? 'ok' : 'warning',
    home.ok
      ? `“${(home.title ?? home.h1 ?? project.domain).slice(0, 48)}” · ${home.wordCount.toLocaleString('en-US')} words`
      : 'Could not read the homepage · continuing from the sitemap'
  )
  checkpoint()

  // 2. Sitemap (robots.txt first).
  tracker.start('sitemap', '/robots.txt, /sitemap.xml')
  let sitemapProblem: string | null = null
  if (force || !project.hasPages) {
    try {
      const report = await rt.sync(projectId, 'manual')
      if (report.pageCount === 0) sitemapProblem = report.problems[0] ?? 'No sitemap was found.'
    } catch (error) {
      sitemapProblem = error instanceof Error ? error.message : 'The sitemap could not be read.'
    }
  }
  const listed = await withProject(host, projectId, 'start:homework', (opened) => ({
    pages: listStartPages(opened.db),
    sitemaps: countSitemaps(opened.db)
  }))
  const pages = listed.pages
  tracker.setKnown({ pageCount: pages.length })
  tracker.finish(
    'sitemap',
    pages.length > 0 ? 'ok' : 'warning',
    pages.length > 0
      ? `/robots.txt, ${listed.sitemaps} ${listed.sitemaps === 1 ? 'sitemap' : 'sitemaps'} · ${pages.length.toLocaleString('en-US')} pages`
      : (sitemapProblem ?? 'No pages found in a sitemap')
  )
  checkpoint()

  // 3. Sections.
  tracker.start('sections', `${pages.length.toLocaleString('en-US')} pages`)
  const sections = buildSections(pages)
  tracker.setKnown({
    sections: sections.map((section) => ({
      key: section.key,
      label: section.label,
      pageCount: section.pageCount
    }))
  })
  const biggest = sections[0]
  tracker.finish(
    'sections',
    sections.length > 0 ? 'ok' : 'warning',
    biggest === undefined
      ? 'No sections yet'
      : `${sections.length} ${sections.length === 1 ? 'section' : 'sections'} · ${biggest.label} is the biggest (${biggest.pageCount})`
  )
  checkpoint()

  // 4. Key pages: the usual paths, then the likeliest pages from the sitemap. One retry each.
  const profile = project.profile
  const competitors = profile?.competitors ?? []
  const candidates = shortlist(pages.filter((page) => !page.tracked))
  const keyTargets = keyPageTargets(root, candidates)
  tracker.start('key_pages', keyTargets.map((target) => pathOfUrl(target.url)).join(', '))
  let retried = 0
  let skipped = 0
  const addTargets = async (): Promise<boolean> => {
    const known = new Set(keyTargets.map((target) => target.url))
    const added = (await hooks.edits())
      .filter((record) => record.undoneAt === null)
      .flatMap((record) =>
        record.edit.kind === 'page' && record.edit.op === 'add' ? [record.edit.url] : []
      )
      .filter((url) => !known.has(url))
    for (const url of added) keyTargets.push({ url, role: 'other' })
    return added.length > 0
  }
  // Two key pages are read at once (the read pool's limit on one site); the reads are
  // kept in target order. Pages the user adds meanwhile are read once these are done.
  const turns = createLimiter(PAGE_READS_PER_SITE)
  let done = 0
  const readKeyPage = async (target: {
    url: string
    role: SiteRead['role']
  }): Promise<SiteRead | null> => {
    if (stopped()) return null
    const path = pathOfUrl(target.url)
    tracker.sub('key_pages', { label: path, state: 'running', detail: 'Reading' })
    let read = await withProject(host, projectId, 'start:homework', (opened) =>
      readOne(host, opened.db, target.url, target.role, force)
    )
    if (!read.ok) {
      read = await withProject(host, projectId, 'start:homework', (opened) =>
        readOne(host, opened.db, target.url, target.role, true)
      )
      if (read.ok) {
        retried += 1
        tracker.sub('key_pages', {
          label: path,
          state: 'retried',
          detail: 'First read failed · worked on try 2'
        })
      } else {
        skipped += 1
        tracker.sub('key_pages', {
          label: path,
          state: 'skipped',
          detail: 'Could not be read twice · left out'
        })
      }
    } else {
      tracker.sub('key_pages', { label: path, state: 'ok', detail: 'Read' })
    }
    done += 1
    tracker.update('key_pages', { progress: { done, total: keyTargets.length } })
    return read
  }
  await addTargets()
  let from = 0
  do {
    const batch = keyTargets.slice(from)
    from = keyTargets.length
    tracker.update('key_pages', { progress: { done, total: keyTargets.length } })
    let started = 0
    const got = await Promise.all(
      batch.map((target) =>
        turns.run(() => {
          started += 1
          tracker.setKnown({
            upNext: batch.slice(started).map((next) => pathOfUrl(next.url))
          })
          return readKeyPage(target)
        })
      )
    )
    for (const read of got) if (read !== null) reads.push(read)
    checkpoint()
  } while (await addTargets())
  const readOk = reads.filter((read) => read.ok).length
  tracker.setKnown({ upNext: [] })
  tracker.update('key_pages', { progress: null })
  tracker.finish(
    'key_pages',
    readOk > 1 ? 'ok' : 'warning',
    [
      `${readOk} read`,
      retried > 0 ? `${retried} retried` : '',
      skipped > 0 ? `${skipped} skipped` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  )

  // 5. The pages and topics with the most to gain: code ranks, Claude explains the page
  //    picks and writes the seeds, in two calls side by side.
  tracker.start('pick', `From ${candidates.length} candidate pages`)
  const { picked, topics: firstTopics } = await firstPicks(host, projectId, {
    domain: project.domain,
    profile,
    pages,
    sections,
    reads,
    readable: candidates.length > 0 || readOk > 0
  })
  tracker.setKnown({
    picked: picked.pages.length,
    pickedPages: picked.pages.map((page) => ({ url: page.url, path: page.path }))
  })
  tracker.finish(
    'pick',
    picked.source === 'claude' ? 'ok' : 'warning',
    picked.source === 'claude'
      ? `${picked.pages.length} of ${pages.length.toLocaleString('en-US')} picked`
      : `${picked.pages.length} picked from addresses · CiteFox AI could not be reached`
  )
  checkpoint()

  // 6. Rivals: the project's saved competitors, switch-from options and integrations.
  tracker.start('rivals')
  const rivals = mergeRivals(competitors, [], {
    switchingFrom: profile?.switchingFrom ?? [],
    integrations: profile?.integrations ?? []
  })
  tracker.setKnown({ rivals })
  tracker.finish('rivals', 'ok', rivalSummary(rivals))
  checkpoint()

  // 7–9. The topic: profile, questions, page matches. Needs Claude and a seed.
  const best = firstTopics[0] ?? null
  const seed = best?.seed ?? null
  let draft: TopicDraft | null = null
  /** Claude's questions as written; the user's edits apply on top and stay undoable. */
  let written: StartQuestion[] = []
  let buyers: StartBuyers = { who: null, segments: [], triggers: [] }
  let message = picked.message
  if (seed === null) {
    for (const id of ['profile', 'questions', 'plan'] as const) {
      tracker.start(id)
      tracker.finish(id, 'warning', 'Needs an AI · start a topic yourself later')
    }
  } else {
    const topics = createTopicsService(host, deps.checks, (event: TopicProgress) => {
      if (event.step === 'journey_questions' && event.total > 0) {
        tracker.update('questions', {
          detail: `${Math.min(event.done, event.total)} of ${event.total} · CiteFox AI`,
          progress: { done: event.done, total: event.total }
        })
      }
    })
    try {
      tracker.start('profile', 'CiteFox AI')
      draft = await createTopicDraft(topics, projectId, seed, best?.productId ?? null)
      hooks.onDraft(draft.id)
      draft = await feedDraftBeforeProfile(topics, draft, rivals, await hooks.edits())
      draft = await topics['topics:writeProfile']({ projectId, draftId: draft.id })
      buyers = buyersOf(draft)
      tracker.setKnown({ buyers })
      tracker.finish(
        'profile',
        'ok',
        `CiteFox AI · ${buyers.segments.length} segments, ${buyers.triggers.length} triggers`
      )
      checkpoint()

      draft = await feedProfileEdits(topics, draft, await hooks.edits())
      tracker.start('questions', `0 of ${START_QUESTION_COUNT} · CiteFox AI`)
      tracker.update('questions', { label: `Draft ${START_QUESTION_COUNT} buyer questions` })
      draft = await topics['topics:generateQuestions']({ projectId, draftId: draft.id })
      const questionTexts = includedQuestions(draft).map((prompt) => prompt.text)
      written = draftQuestions(draft)
      tracker.setKnown({ questions: written })
      tracker.update('questions', { progress: null })
      // A rival the user removed while questions were being written must not appear in them.
      const editsNow = await hooks.edits()
      const naming = editsNow.some(
        (record) =>
          record.undoneAt === null && record.edit.kind === 'rival' && record.edit.op === 'remove'
      )
      let rewrote = 0
      if (naming) {
        tracker.update('questions', { detail: 'Rewriting questions with your change' })
        const fixed = await rewriteForRemovedRivals(
          deps,
          topics,
          projectId,
          draft.id,
          applyQuestionEdits(draftQuestions(draft), editsNow),
          editsNow
        )
        rewrote = fixed.rewritten
      }
      tracker.finish(
        'questions',
        'ok',
        `${questionTexts.length} written · CiteFox AI${rewrote > 0 ? ` · ${rewrote} rewritten with your change` : ''}`
      )
      checkpoint()

      tracker.start('plan', 'Matching questions to pages')
      draft = await syncDraftQuestions(
        topics,
        draft,
        applyQuestionEdits(draftQuestions(draft), await hooks.edits())
      )
      const matched = await topics['topics:matchPages']({ projectId, draftId: draft.id })
      draft = matched.draft
      tracker.finish(
        'plan',
        'ok',
        `${matched.matched} matched to a page · ${matched.noPage} with no page yet`
      )
    } catch (error) {
      if (error instanceof StartStopped) throw error
      const reason = error instanceof Error ? error.message : 'CiteFox AI could not finish'
      host.logger.warn('start autopilot: topic step failed', { message: reason })
      for (const id of ['profile', 'questions', 'plan'] as const) {
        const item = tracker.snapshot().items.find((entry) => entry.id === id)
        if (item?.state === 'running' || item?.state === 'pending') {
          if (item.state === 'pending') tracker.start(id)
          tracker.finish(id, 'failed', 'CiteFox AI could not finish this step')
        }
      }
      message =
        'CiteFox AI could not write the buyer profile and questions. Try again, or start a topic yourself.'
    }
  }

  // The plan: questions per picked page, the top 3 ticked.
  const matchedDraft = draft
  const questions = written.map((question) => ({
    ...question,
    targetUrl: matchedDraft?.prompts.find((prompt) => prompt.id === question.id)?.targetUrl ?? null
  }))
  const withCounts = countQuestions(picked.pages, questions)
  const recommendedUrls = recommend(withCounts)
  const plan: SiteStartPlan = await withProject(host, projectId, 'start:homework', (opened) => {
    const next: SiteStartPlan = {
      projectId,
      domain: project.domain,
      pageCount: pages.length,
      sitemapCount: listed.sitemaps,
      sitemapProblem: pages.length > 0 ? null : sitemapProblem,
      sections: annotateSections(sections, withCounts),
      pagesRead: reads.map((read) => ({ url: read.url, ok: read.ok })),
      retried,
      skipped,
      pages: withCounts,
      recommendedUrls,
      topics: firstTopics.map((topic) => ({
        seed: topic.seed,
        reason: topic.reason,
        evidence: topic.evidence,
        caution: topic.caution
      })),
      rivals,
      buyers,
      topic: draft === null ? null : topicOf(draft),
      questions,
      source: picked.source,
      message,
      label:
        picked.source === 'claude'
          ? assistLabel(
              connectionOf(host, projectId),
              expectedSeconds(
                { assistId: START_ASSIST_ID },
                historyDatabases(host, projectId),
                EXPECTED_PICK_SECONDS
              )
            )
          : null,
      budget: {
        markets: 1,
        promptsPerPage: 0,
        questionsPerTopic: questions.length,
        samples: 1,
        searchesLeft: null
      },
      elapsedMs: Math.max(0, Date.now() - began),
      builtAt: host.now().toISOString(),
      topicId: null,
      firstCheckAt: null
    }
    saveStartPlan(opened.db, next)
    return next
  })
  return plan
}

/** Homepage-adjacent key paths first, then the likeliest sitemap pages, each once. */
function keyPageTargets(
  root: string,
  candidates: readonly StartPageRow[]
): { url: string; role: SiteRead['role'] }[] {
  const out: { url: string; role: SiteRead['role'] }[] = []
  const seen = new Set<string>()
  const add = (url: string, role: SiteRead['role']): void => {
    const key = (normalizeUrl(url) ?? url).replace(/\/$/u, '')
    if (seen.has(key)) return
    seen.add(key)
    out.push({ url, role })
  }
  for (const page of KEY_PAGE_PATHS) add(`${root}${page.path}`, page.role)
  // The likeliest page of each kind (a comparison, an alternatives page, a use case…),
  // so Claude sees one of each instead of six of the same.
  const kinds = new Set<string>()
  for (const page of candidates) {
    if (kinds.size >= EXTRA_READS) break
    const kind = pageKind(page.url)
    if (kinds.has(kind)) continue
    kinds.add(kind)
    add(page.url, 'other')
  }
  return out
}

/** Project competitors first (they are named by the user), then Claude's, each name once. */
export function mergeRivals(
  competitors: readonly string[],
  fromClaude: readonly StartRival[],
  saved: { switchingFrom: readonly string[]; integrations: readonly string[] } = {
    switchingFrom: [],
    integrations: []
  }
): StartRival[] {
  const out: StartRival[] = []
  const seen = new Set<string>()
  const key = (value: string): string =>
    value
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/^www\./u, '')
      .replace(/\..*$/u, '')
      .replace(/[^a-z0-9]+/gu, '')
  for (const rival of fromClaude) {
    const id = key(rival.domain ?? rival.name)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(rival)
  }
  for (const competitor of competitors) {
    const id = key(competitor)
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const domain = /\./u.test(competitor) ? competitor.replace(/^https?:\/\//u, '') : null
    out.push({
      name: competitor.replace(/^https?:\/\//u, '').replace(/^www\./u, ''),
      domain,
      kind: 'competitor',
      reason: 'On your project'
    })
  }
  const savedGroups: [readonly string[], StartRival['kind'], string][] = [
    [saved.switchingFrom, 'switch_from', 'Buyers switch from it (your project)'],
    [saved.integrations, 'partner', 'Integration on your project']
  ]
  for (const [names, kind, reason] of savedGroups) {
    for (const name of names) {
      const id = key(name)
      if (id.length === 0 || seen.has(id)) continue
      seen.add(id)
      out.push({ name, domain: null, kind, reason })
    }
  }
  const order = { competitor: 0, switch_from: 1, partner: 2 } as const
  return out.sort((left, right) => order[left.kind] - order[right.kind])
}

function rivalSummary(rivals: readonly StartRival[]): string {
  const count = (kind: StartRival['kind']): number =>
    rivals.filter((rival) => rival.kind === kind).length
  const parts = [
    `${count('competitor')} ${count('competitor') === 1 ? 'competitor' : 'competitors'}`,
    `${count('switch_from')} switch-from`,
    `${count('partner')} ${count('partner') === 1 ? 'partner' : 'partners'}`
  ]
  return parts.join(' · ')
}

async function createTopicDraft(
  topics: TopicsService,
  projectId: string,
  seed: string,
  productId: string | null
): Promise<TopicDraft> {
  const created = await topics['topics:createDraft']({
    projectId,
    path: 'seed',
    seed,
    name: seed
  })
  return topics['topics:updateDraft']({
    projectId,
    draftId: created.id,
    patch: {
      generate: 'questions',
      questionDepth: { preset: 'custom', perStage: splitAcrossStages(START_QUESTION_COUNT) },
      step: 'questions',
      // The seed is about one product: the profile and questions read its competitors.
      ...(productId === null ? {} : { product: { mode: 'pick' as const, productId } })
    }
  })
}

function buyersOf(draft: TopicDraft): StartBuyers {
  const points = currentProfilePoints(draft)
  const texts = (section: string): string[] =>
    points.filter((point) => point.section === section).map((point) => point.text)
  return {
    who: texts('who')[0] ?? null,
    segments: texts('segments').slice(0, 6),
    triggers: texts('triggers').slice(0, 4)
  }
}

function includedQuestions(draft: TopicDraft): TopicDraft['prompts'] {
  return draft.prompts.filter((prompt) => prompt.kind === 'question' && prompt.included)
}

function topicOf(draft: TopicDraft): StartTopicDraft {
  const questions = includedQuestions(draft)
  return {
    draftId: draft.id,
    name: draft.name,
    seed: draft.seed,
    questionCount: questions.length,
    stageCount: new Set(questions.map((prompt) => prompt.stage).filter(Boolean)).size
  }
}

function urlKey(url: string): string {
  return (normalizeUrl(url) ?? url).replace(/\/$/u, '').toLowerCase()
}

/** How many drafted questions each picked page answers best. */
export function countQuestions(
  pages: readonly SiteStartPage[],
  questions: readonly StartQuestion[]
): SiteStartPage[] {
  const counts = new Map<string, number>()
  for (const question of questions) {
    if (question.targetUrl === null) continue
    const key = urlKey(question.targetUrl)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return pages.map((page) => ({ ...page, questionCount: counts.get(urlKey(page.url)) ?? 0 }))
}

/** The pages ticked on the plan: most questions first, then Claude's order; never tracked ones. */
export function recommend(pages: readonly SiteStartPage[]): string[] {
  return pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => !page.alreadyTracked)
    .sort(
      (left, right) =>
        right.page.questionCount - left.page.questionCount || left.index - right.index
    )
    .slice(0, START_RECOMMENDED_PAGES)
    .map(({ page }) => page.url)
}
