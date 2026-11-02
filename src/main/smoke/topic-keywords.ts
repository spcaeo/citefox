import { TOPIC_STAGES } from '@shared/domain'
import type { TopicDraft } from '@shared/domain'
import { cleanHeading, cleanHeadings, competitorName } from '../topics/competitor-page'
import {
  isCompetitorFamily,
  nameKeys,
  namesAny,
  topicOptions,
  type TopicOptions
} from '../topics/keyword-rules'
import { competitorContext } from '../engine/competitor-context'
import { closeProjectDatabase, openProjectDatabase } from '../storage'
import { topicScope } from '../topics/step-blocks'
import { SmokeError } from './errors'
import type { SmokeHookResult, TopicSmokeHookContext } from './hook-context'
import { step } from './live'
import { countBy, formatCounts, namesBrand, TOPIC_SMOKE_PROJECT } from './topic-args'

/**
 * Topic keywords and the competitor page in the live smoke (Docs/PROMPT-AUDIT.md,
 * package P4). Runs at the end of every `--topic` run; `competitorUrl` is the
 * `--competitor <url>` flag, or null.
 *
 * Both read the topic's competitors as the steps do (`competitorContext` for the
 * topic), so the check and the step agree on what a listed option is. A keyword or
 * question that breaks a rule is set aside and printed with why, as the steps drop
 * it; the smoke fails only when that leaves a group (or the questions) empty, or a
 * keyword names the brand.
 *
 * `keyword-groups`: prints every keyword by group. In an "Alternatives & vs" or
 * "Competitor vs" group a keyword must name a listed option; in any other group it
 * names no competitor. No Claude call.
 *
 * `competitor` (with `--competitor`): reads the page (one Jina read, no search),
 * writes its questions and claims (`competitor_page_questions_v2` and
 * `competitor_page_claims`, in parallel) and prints them. A question must name
 * neither brand and have one of their headings as its section.
 */
export async function runTopicKeywordsSmoke(
  context: TopicSmokeHookContext,
  competitorUrl: string | null
): Promise<SmokeHookResult> {
  const ids = { projectId: context.projectId, draftId: context.draftId }
  const draft = await context.handlers['topics:getDraft'](ids)
  const db = openProjectDatabase(context.storage.paths.projectsDirectory, TOPIC_SMOKE_PROJECT.slug)
  let options: TopicOptions
  try {
    options = topicOptions(competitorContext(db, topicScope(db, draft)), draft)
  } finally {
    closeProjectDatabase(db)
  }
  const groups = await step(context.push, context.secrets, 'keyword-groups', async () =>
    checkKeywordGroups(draft, options)
  )
  for (const line of groups.lines) context.io.stdout(line)
  if (competitorUrl === null) return { ran: true, detail: groups.detail }

  const competitor = await step(context.push, context.secrets, 'competitor', async () => {
    const read = await context.handlers['topics:readCompetitorPage']({
      ...ids,
      url: competitorUrl
    })
    if (!read.page.ok) throw new SmokeError(`Could not read ${competitorUrl}.`)
    const result = await context.handlers['topics:competitorQuestions']({
      ...ids,
      marketId: context.marketId
    })
    return checkCompetitor(result.draft, read.page, result.claims, options, result.droppedForBrand)
  })
  for (const line of competitor.lines) context.io.stdout(line)
  return { ran: true, detail: `${groups.detail}; ${competitor.detail}` }
}

interface Checked {
  detail: string
  lines: string[]
}

/**
 * The keyword checks, on the saved draft. A keyword that breaks its group's rule is
 * set aside with why; the check fails only when a group is left with none, or a
 * keyword names the brand (the step drops those, so one here is a leak).
 */
export function checkKeywordGroups(draft: TopicDraft, options: TopicOptions): Checked {
  const keywords = draft.prompts.filter((prompt) => prompt.kind === 'keyword' && prompt.included)
  const leaks: string[] = []
  const setAside: string[] = []
  const byGroup = new Map<string, { kept: string[]; total: number }>()
  for (const prompt of keywords) {
    const group = prompt.kwGroup ?? 'none'
    const entry = byGroup.get(group) ?? { kept: [], total: 0 }
    byGroup.set(group, entry)
    entry.total += 1
    if (namesBrand(prompt.text, draft.brandNames)) leaks.push(`"${prompt.text}" names the brand`)
    const family = prompt.kwFamily
    let why: string | null = null
    if (family !== null && isCompetitorFamily(family)) {
      const keys =
        family === 'alternatives_vs'
          ? [...options.competitorKeys, ...options.switchKeys]
          : options.competitorKeys
      if (!namesAny(prompt.text, keys)) why = 'names no listed option'
    } else if (namesAny(prompt.text, options.competitorKeys)) {
      why = 'names a competitor'
    }
    if (why === null) entry.kept.push(prompt.text)
    else setAside.push(`keyword set aside (${group}): "${prompt.text}" ${why}`)
  }
  if (leaks.length > 0) throw new SmokeError(`Keyword check: ${leaks.slice(0, 3).join('; ')}.`)
  const empty = [...byGroup].filter(([, entry]) => entry.kept.length === 0).map(([group]) => group)
  if (empty.length > 0) {
    throw new SmokeError(
      `Keyword check: no keyword in ${empty.join(', ')} passes its rule (${setAside.slice(0, 3).join('; ')}).`
    )
  }
  return {
    detail: `groups=${byGroup.size} set-aside=${setAside.length} brand-free`,
    lines: [
      ...[...byGroup].map(([group, entry]) => `keywords ${group}: ${entry.kept.join(' | ')}`),
      ...setAside
    ]
  }
}

/** The competitor checks, on the saved draft and claims. Exported for the unit test. */
export function checkCompetitor(
  draft: TopicDraft,
  page: { domain: string; title: string | null; h1: string | null; outline: readonly string[] },
  claims: readonly {
    claim: string
    onYourSite: string
    section: string | null
    yourEvidence?: string | null
  }[],
  options: TopicOptions,
  droppedForNames: number
): Checked {
  const name = competitorName({ domain: page.domain, title: page.title, h1: page.h1, text: '' })
  const headings = new Set(cleanHeadings(page.outline))
  if (page.h1 !== null) headings.add(cleanHeading(page.h1))
  const avoid = [...nameKeys(name, page.domain), ...options.competitorKeys]
  const written = draft.prompts.filter((prompt) => prompt.source === 'competitor')
  if (written.length === 0) throw new SmokeError('Claude wrote no questions from their page.')
  // Each question and claim on its own: one that breaks a rule is set aside with why.
  const setAside: string[] = []
  const questions = written.filter((question) => {
    const section = question.sourceNote?.replace(/^From their section: /u, '') ?? null
    const why =
      namesBrand(question.text, draft.brandNames) || namesAny(question.text, avoid)
        ? 'names a brand'
        : section === null || !headings.has(section)
          ? `has section "${section ?? 'none'}", not one of theirs`
          : null
    if (why !== null) setAside.push(`question set aside: "${question.text}" ${why}`)
    return why === null
  })
  for (const claim of claims) {
    if (claim.section !== null && !headings.has(claim.section)) {
      setAside.push(`claim set aside: "${claim.claim}" has section "${claim.section}"`)
    }
    const evidence = claim.yourEvidence ?? null
    if (evidence !== null && !evidence.startsWith('/')) {
      setAside.push(`claim set aside: "${claim.claim}" cites "${evidence}", not a page read`)
    }
  }
  if (questions.length === 0) {
    throw new SmokeError(
      `Competitor check: no question passes (${setAside.slice(0, 3).join('; ')}).`
    )
  }
  const stages = countBy(questions, (prompt) => prompt.stage ?? 'none')
  const ordered = Object.fromEntries(
    TOPIC_STAGES.filter((stage) => stages[stage] !== undefined).map((stage) => [
      stage,
      stages[stage] ?? 0
    ])
  )
  return {
    detail: `name="${name}" questions=${questions.length} ${formatCounts(ordered)} dropped-for-names=${droppedForNames} claims=${claims.length} ${formatCounts(countBy(claims, (claim) => claim.onYourSite))} set-aside=${setAside.length}`,
    lines: [
      ...questions.map(
        (question, index) =>
          `competitor question ${index + 1} [${question.stage ?? 'none'}]: ${question.text} (${question.sourceNote ?? ''})`
      ),
      ...claims.map(
        (claim, index) =>
          `competitor claim ${index + 1} (${claim.onYourSite}): ${claim.claim} · ${claim.section ?? 'no section'}${claim.yourEvidence ? ` · ${claim.yourEvidence}` : ''}`
      ),
      ...setAside
    ]
  }
}
