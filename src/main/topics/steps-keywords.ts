import { KEYWORD_INTENT_FAMILY_LABEL } from '@shared/domain'
import type {
  FunnelStage,
  KeywordCoreTerm,
  KeywordGroupKind,
  KeywordIntent,
  KeywordIntentFamily,
  PageType,
  TopicDraft,
  TopicDraftPrompt,
  TopicStage
} from '@shared/domain'
import type {
  CsvColumnsResult,
  DiscoverTermsResult,
  GenerateTopicKeywordsResult,
  ImportTopicQuestionsRequest,
  ImportTopicQuestionsResult,
  MergeNearDuplicatesResult,
  MissingGroupsResult,
  QuestionCleanupResult,
  TopicCallInfo,
  TopicCsvMapping
} from '@shared/ipc'
import { expandPatternKeywords, keywordDepthPreset } from '@shared/topic-depth'
import { competitorContext } from '../engine/competitor-context'
import { competitorBlock, evidenceBlock, productBlock } from '../prompts/blocks'
import { bullets, runTopicTemplate } from './claude'
import {
  keywordSummary,
  newDraftPrompt,
  saveDraft,
  searchesLeftFor,
  TopicInputError
} from './drafts'
import { brandVars, progressFor, type OpenedProject, type TopicEnv } from './env'
import {
  cleanKeywordPattern,
  familyLines,
  isCompetitorFamily,
  KEYWORD_FAMILY_RULES,
  keywordsPerFamily,
  keywordWordsFit,
  MAX_TOPIC_PATTERNS,
  namesAny,
  normalizeKeyword,
  patternsToApply,
  topicOptions
} from './keyword-rules'
import { ownEvidencePages } from './own-evidence'
import { readSite } from './site'
import { marketBlockFor, topicBuyerBlock, topicScope } from './step-blocks'
import { cleanupContext } from './steps-journey'
import { cleanImportLines, namesBrand, nearDuplicateKeywords, parseCsv } from './text'

export { competitorQuestions, readCompetitorPage } from './steps-competitor'

interface GroupReply {
  name: string
  kind: KeywordGroupKind
  family: KeywordIntentFamily | null
  intent: KeywordIntent
  funnel: FunnelStage
  pageType: PageType
  keywords: string[]
}

/** Characters of each own page the core-terms step sees. */
const TERMS_EVIDENCE_CHARS = 1500

/** `topics:discoverTerms`: core terms and synonyms (suggestions; Apply writes keywordTerms). */
export async function discoverTerms(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<DiscoverTermsResult> {
  const reads = await readSite(env.host, opened.db, draft.website || opened.project.domain)
  const context = competitorContext(opened.db, topicScope(opened.db, draft))
  const options = topicOptions(context, draft)
  const buyer = topicBuyerBlock(draft, { triggers: false })
  const reply = await runTopicTemplate<{
    terms: { term: string; synonyms: string[] }[]
    patterns: string[]
  }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: draft.topicId,
    kind: 'topic_keyword_terms',
    channel: 'topics:discoverTerms',
    context: {
      seed: draft.seed,
      count: Math.max(1, draft.depth.keywords.synonymsPerCoreTerm),
      product_block: productBlock(context.product),
      market_block: marketBlockFor(opened.db, draft.marketIds[0] ?? null),
      buyer_block: buyer,
      evidence: evidenceBlock(
        ownEvidencePages(reads, `${draft.seed}\n${buyer}`, TERMS_EVIDENCE_CHARS),
        TERMS_EVIDENCE_CHARS
      ),
      ...brandVars(draft.brandNames)
    }
  })
  const names = [...options.competitorKeys, ...options.switchKeys]
  const allowed = (text: string, min: number, max: number): boolean => {
    const count = text.split(' ').filter(Boolean).length
    return (
      count >= min && count <= max && !namesBrand(text, draft.brandNames) && !namesAny(text, names)
    )
  }
  // Code checks: a term is 2 to 4 words, a synonym 1 to 5; lower case; no brand,
  // competitor or switch-from name; no synonym repeats a term or another synonym.
  const kept = reply.value.terms
    .map((item) => ({ term: normalizeKeyword(item.term), synonyms: item.synonyms }))
    .filter(
      (item, index, all) =>
        allowed(item.term, 2, 4) && all.findIndex((other) => other.term === item.term) === index
    )
  const seen = new Set(kept.map((item) => item.term))
  const terms: KeywordCoreTerm[] = kept.map((item) => ({
    id: `term-${env.host.createId()}`,
    term: item.term,
    synonyms: item.synonyms.map(normalizeKeyword).filter((synonym) => {
      if (!allowed(synonym, 1, 5) || seen.has(synonym)) return false
      seen.add(synonym)
      return true
    }),
    kept: true
  }))
  // Patterns: the modifiers buyers of this category search, saved on the draft for
  // the coverage expansion. Checked in code: one {X}, 1 to 4 other words, no names.
  const patterns = [
    ...new Set(
      reply.value.patterns
        .map(cleanKeywordPattern)
        .filter((pattern): pattern is string => pattern !== null)
        .filter((pattern) => {
          const words = pattern.replace(/\{X\}|\{segment\}/gu, ' ')
          return !namesBrand(words, draft.brandNames) && !namesAny(words, names)
        })
    )
  ].slice(0, MAX_TOPIC_PATTERNS)
  saveDraft(opened.db, { ...draft, keywordPatterns: patterns }, env.host.now())
  return { draftId: draft.id, terms, patterns, info: reply.info }
}

function keywordPrompt(
  env: TopicEnv,
  draft: TopicDraft,
  text: string,
  group: {
    name: string
    kind: KeywordGroupKind
    family: KeywordIntentFamily | null
    intent: KeywordIntent | null
    funnel: FunnelStage | null
    pageType: PageType | null
  }
): TopicDraftPrompt {
  return newDraftPrompt(
    {
      kind: 'keyword',
      text,
      source: 'claude',
      kwGroup: group.name,
      kwGroupKind: group.kind,
      kwFamily: group.family,
      intent: group.intent,
      funnel: group.funnel,
      pageType: group.pageType
    },
    `tk-${env.host.createId()}`,
    draft.brandNames
  )
}

/** One accepted intent group: its family's label, mapping and checked keywords. */
interface WrittenGroup {
  name: string
  kind: KeywordGroupKind
  family: KeywordIntentFamily
  intent: KeywordIntent
  funnel: FunnelStage
  pageType: PageType
  keywords: string[]
}

interface WrittenGroups {
  groups: WrittenGroup[]
  droppedForBrand: number
  /** Keywords dropped for naming a competitor where none belongs, or none where one must. */
  droppedForNames: number
  info: TopicCallInfo | null
}

/**
 * Intent groups for `families`, in parallel: `topic_keyword_expand` for the plain
 * families (no competitor list) and `topic_keyword_competitor` for the "Alternatives
 * & vs" and "Competitor vs" families (the topic's own competitors only). Code then
 * checks every keyword: brand absent everywhere; in a competitor family it names a
 * listed option, in any other family it names no competitor.
 */
async function writeGroups(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: {
    families: readonly KeywordIntentFamily[]
    terms: string
    existing: readonly string[]
    count: (families: number) => number
    channel: string
  }
): Promise<WrittenGroups> {
  const context = competitorContext(opened.db, topicScope(opened.db, draft))
  const options = topicOptions(context, draft)
  const named = options.competitors.length + options.partial.length > 0
  const plain = request.families.filter((family) => !isCompetitorFamily(family))
  const competitor = request.families.filter(
    (family) =>
      isCompetitorFamily(family) &&
      (named || (family === 'alternatives_vs' && options.switchingFrom.length > 0))
  )
  const count = request.count(plain.length + competitor.length)
  const market = marketBlockFor(opened.db, draft.marketIds[0] ?? null)
  const shared = {
    seed: draft.seed,
    terms: request.terms,
    count,
    market_block: market,
    ...brandVars(draft.brandNames)
  }
  const started = Date.now()
  const [plainReply, competitorReply] = await Promise.all([
    plain.length === 0 || count === 0
      ? null
      : runTopicTemplate<{ groups: GroupReply[] }>({
          host: env.host,
          db: opened.db,
          projectId: opened.project.id,
          pageId: draft.topicId,
          kind: 'topic_keyword_expand',
          channel: request.channel,
          context: {
            ...shared,
            segments: draft.segments.join(', ') || 'none',
            keywords: bullets(request.existing),
            families: familyLines(plain)
          }
        }),
    competitor.length === 0 || count === 0
      ? null
      : runTopicTemplate<{ groups: GroupReply[] }>({
          host: env.host,
          db: opened.db,
          projectId: opened.project.id,
          pageId: draft.topicId,
          kind: 'topic_keyword_competitor',
          channel: request.channel,
          context: {
            ...shared,
            competitor_block: competitorBlock({
              product: context.product,
              direct: options.competitors,
              partial: options.partial,
              switchingFrom: options.switchingFrom,
              integrations: options.integrations
            }),
            families: familyLines(competitor)
          }
        })
  ])
  const out: WrittenGroups = { groups: [], droppedForBrand: 0, droppedForNames: 0, info: null }
  // Each keyword is checked on its own: one that breaks a rule is dropped (and logged
  // with why), never the group or the step. A group left with none is not added.
  const why: string[] = []
  const seen = new Set(request.existing.map(normalizeKeyword))
  const accept = (
    reply: { groups: GroupReply[] } | undefined,
    wanted: KeywordIntentFamily[]
  ): void => {
    for (const group of reply?.groups ?? []) {
      const family = group.family
      if (family === null || !wanted.includes(family)) continue
      const rule = KEYWORD_FAMILY_RULES[family]
      const mustName = isCompetitorFamily(family)
      const optionKeys =
        family === 'alternatives_vs'
          ? [...options.competitorKeys, ...options.switchKeys]
          : options.competitorKeys
      const keywords: string[] = []
      for (const raw of group.keywords) {
        const text = normalizeKeyword(raw)
        if (text.length === 0 || seen.has(text) || !keywordWordsFit(text, family)) continue
        if (namesBrand(text, draft.brandNames)) {
          out.droppedForBrand += 1
          continue
        }
        const names = mustName ? namesAny(text, optionKeys) : namesAny(text, options.competitorKeys)
        if (names !== mustName) {
          out.droppedForNames += 1
          why.push(`"${text}": ${mustName ? 'names no listed option' : 'names a competitor'}`)
          continue
        }
        seen.add(text)
        keywords.push(text)
      }
      const existing = out.groups.find((item) => item.family === family)
      if (existing !== undefined) existing.keywords.push(...keywords)
      else if (keywords.length > 0) {
        out.groups.push({
          name: KEYWORD_INTENT_FAMILY_LABEL[family],
          kind: 'intent',
          family,
          intent: rule.intent,
          funnel: rule.funnel,
          pageType: rule.pageType,
          keywords
        })
      }
    }
  }
  accept(plainReply?.value, plain)
  accept(competitorReply?.value, competitor)
  // Groups in the order the families were asked for.
  out.groups.sort((a, b) => request.families.indexOf(a.family) - request.families.indexOf(b.family))
  const first = plainReply ?? competitorReply
  if (first !== null) {
    out.info = { ...first.info, durationMs: Math.max(0, Date.now() - started) }
  }
  if (out.droppedForNames > 0) {
    env.host.logger.info('topic keywords dropped for competitor names', {
      channel: request.channel,
      dropped: out.droppedForNames,
      why: why.slice(0, 10)
    })
  }
  return out
}

const NO_CALL_INFO: TopicCallInfo = {
  label: { connection: 'claude-code', connectionText: '', expectedSeconds: 0, text: '' },
  durationMs: 0,
  model: null,
  searchesUsed: 0
}

/** "email to text (email to sms, sms from email); …" for `{{ terms }}`. */
function termsText(terms: readonly KeywordCoreTerm[]): string {
  return terms
    .map((term) =>
      term.synonyms.length === 0 ? term.term : `${term.term} (${term.synonyms.join(', ')})`
    )
    .join('; ')
}

/**
 * `topics:generateKeywords`: coverage groups expanded in code from the kept
 * terms and the depth settings, then intent groups from Claude (plain and
 * competitor families in parallel), all capped by the depth's per-group cap and
 * max keywords. Claude is asked for as many per family as the budget left after
 * the code-made keywords allows, so no family is cut off. Brand keywords are dropped.
 */
export async function generateKeywords(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  replace: boolean
): Promise<GenerateTopicKeywordsResult> {
  const depth = draft.depth.keywords
  const terms = draft.keywordTerms.filter((term) => term.kept)
  if (terms.length === 0) {
    throw new TopicInputError(
      'Add or discover core terms first.',
      'Use Discover core terms & synonyms.'
    )
  }
  const progress = progressFor(env, {
    projectId: opened.project.id,
    draftId: draft.id,
    topicId: draft.topicId,
    step: 'keyword_expand'
  })
  progress('running', 0, 2, 'Expanding patterns')
  const patternBudget =
    depth.intentFamilies.length === 0 ? depth.maxKeywords : Math.ceil(depth.maxKeywords * 0.5)
  const patternDepth = {
    ...depth,
    patternVariants: patternsToApply(
      depth,
      draft.keywordPatterns,
      keywordDepthPreset(depth.preset === 'custom' ? 'standard' : depth.preset).patternVariants
    )
  }
  const fromPatterns = expandPatternKeywords(
    terms,
    patternDepth,
    draft.segments,
    patternBudget
  ).filter((item) => !namesBrand(item.text, draft.brandNames))
  const keywords: TopicDraftPrompt[] = fromPatterns.map((item) =>
    keywordPrompt(env, draft, item.text, {
      name: item.group,
      kind: 'coverage',
      family: null,
      intent: 'commercial',
      funnel: 'mofu',
      pageType: 'landing page'
    })
  )
  let fromClaude = 0
  let dropped = 0
  let info = NO_CALL_INFO
  const budget = depth.maxKeywords - keywords.length
  if (depth.intentFamilies.length > 0 && budget > 0) {
    progress('running', 1, 2, 'Writing intent and competitor groups')
    const written = await writeGroups(env, opened, draft, {
      families: depth.intentFamilies,
      terms: termsText(terms),
      existing: fromPatterns.map((item) => item.text),
      count: (families) => keywordsPerFamily(budget, families, depth.perGroupCap),
      channel: 'topics:generateKeywords'
    })
    info = written.info ?? info
    dropped = written.droppedForBrand
    for (const group of written.groups) {
      for (const text of group.keywords.slice(0, depth.perGroupCap)) {
        if (keywords.length >= depth.maxKeywords) break
        fromClaude += 1
        keywords.push(keywordPrompt(env, draft, text, group))
      }
    }
  }
  const kept = replace
    ? draft.prompts.filter((prompt) => prompt.kind !== 'keyword' || prompt.source !== 'claude')
    : draft.prompts
  const next = saveDraft(
    opened.db,
    {
      ...draft,
      step: draft.step === 'questions' ? 'keywords' : draft.step,
      prompts: [...kept, ...keywords]
    },
    env.host.now()
  )
  progress('ok', 2, 2, `${keywords.length} keywords`)
  const left = searchesLeftFor(env.host.storage, opened.db, opened.project.id, env.host.now())
  return {
    draft: next,
    summary: keywordSummary(next, left),
    fromPatterns: fromPatterns.length,
    fromClaude,
    droppedForBrand: dropped,
    info
  }
}

/** `topics:suggestMissingGroups`: intent families the list has no group for. */
export async function suggestMissingGroups(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<MissingGroupsResult> {
  const present = new Set(
    draft.prompts.map((prompt) => prompt.kwFamily).filter((family) => family !== null)
  )
  const missing = draft.depth.keywords.intentFamilies.filter((family) => !present.has(family))
  const families = missing.length > 0 ? missing : draft.depth.keywords.intentFamilies
  const existing = draft.prompts
    .filter((prompt) => prompt.kind === 'keyword')
    .map((prompt) => prompt.text)
  const written = await writeGroups(env, opened, draft, {
    families,
    terms: termsText(draft.keywordTerms) || draft.seed,
    existing,
    count: () => Math.min(8, draft.depth.keywords.perGroupCap),
    channel: 'topics:suggestMissingGroups'
  })
  const taken = new Set(draft.prompts.map((prompt) => prompt.text.toLowerCase()))
  return {
    draftId: draft.id,
    groups: written.groups.map((group) => ({
      name: group.name,
      kind: group.kind,
      family: group.family,
      reason: `No ${group.name} keywords in the list yet.`,
      keywords: group.keywords
        .filter((text) => !taken.has(text))
        .map((text) => ({
          id: `ks-${env.host.createId()}`,
          kind: 'keyword' as const,
          text,
          stage: null,
          kwGroup: group.name,
          kwGroupKind: group.kind,
          kwFamily: group.family,
          intent: group.intent,
          funnel: group.funnel,
          pageType: group.pageType,
          reason: null,
          replacesId: null
        }))
    })),
    info: written.info ?? NO_CALL_INFO
  }
}

/** `topics:mergeNearDuplicates`: pairs worked out in code; `apply` merges them. */
export function mergeNearDuplicates(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  apply: boolean
): MergeNearDuplicatesResult {
  const keywords = draft.prompts.filter((prompt) => prompt.kind === 'keyword')
  const text = new Map(keywords.map((prompt) => [prompt.id, prompt.text]))
  const pairs = nearDuplicateKeywords(
    keywords.map((prompt) => ({ id: prompt.id, text: prompt.text }))
  ).map((pair) => ({
    ...pair,
    keep: text.get(pair.keepId) ?? '',
    drop: text.get(pair.dropId) ?? ''
  }))
  if (!apply || pairs.length === 0) return { pairs, draft: null }
  const dropped = new Set(pairs.map((pair) => pair.dropId))
  const next = draft.prompts
    .filter((prompt) => !dropped.has(prompt.id))
    .map((prompt) => {
      const merged = pairs.filter((pair) => pair.keepId === prompt.id).map((pair) => pair.drop)
      return merged.length === 0
        ? prompt
        : {
            ...prompt,
            mergedFrom: [...prompt.mergedFrom, ...merged],
            flags: [...new Set([...prompt.flags, 'merged' as const])]
          }
    })
  return { pairs, draft: saveDraft(opened.db, { ...draft, prompts: next }, env.host.now()) }
}

// ---------------------------------------------------------------------------
// My own questions
// ---------------------------------------------------------------------------

/** `topics:readCsvColumns`: headers, sample rows and a guessed mapping. */
export function readCsvColumns(content: string): CsvColumnsResult {
  const rows = parseCsv(content)
  const first = rows[0] ?? []
  const lower = first.map((cell) => cell.toLowerCase())
  const looksLikeHeader = lower.some((cell) =>
    /question|query|text|prompt|source|channel|note/u.test(cell)
  )
  const find = (pattern: RegExp): number | null => {
    const index = lower.findIndex((cell) => pattern.test(cell))
    return index === -1 ? null : index
  }
  const question = looksLikeHeader
    ? (find(/question|query|prompt|text/u) ?? 0)
    : longestColumn(rows)
  const guess: TopicCsvMapping = {
    question,
    source: looksLikeHeader ? find(/source|channel|from/u) : null,
    notes: looksLikeHeader ? find(/note|comment/u) : null,
    hasHeader: looksLikeHeader
  }
  return {
    columns: looksLikeHeader ? first : first.map((_, index) => `Column ${index + 1}`),
    sample: rows.slice(looksLikeHeader ? 1 : 0, 6),
    rows: Math.max(0, rows.length - (looksLikeHeader ? 1 : 0)),
    guess
  }
}

function longestColumn(rows: readonly string[][]): number {
  const widths: number[] = []
  for (const row of rows.slice(0, 20))
    row.forEach((cell, index) => (widths[index] = (widths[index] ?? 0) + cell.length))
  let best = 0
  widths.forEach((width, index) => {
    if (width > (widths[best] ?? 0)) best = index
  })
  return best
}

/** `topics:importQuestions`: pasted lines and/or CSV rows → cleaned draft questions. */
export function importQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: ImportTopicQuestionsRequest
): ImportTopicQuestionsResult {
  const lines: { text: string; note: string | null }[] = []
  const pasted = (request.text ?? '').split(/\r?\n/u).filter((line) => line.trim().length > 0)
  for (const line of pasted) lines.push({ text: line, note: 'Pasted' })
  let csvRows = 0
  let csvColumns: string[] = []
  if (request.csv !== null && request.csv !== undefined) {
    const rows = parseCsv(request.csv.content)
    const header = request.csv.mapping.hasHeader ? (rows[0] ?? []) : []
    const body = request.csv.mapping.hasHeader ? rows.slice(1) : rows
    const { question, source, notes } = request.csv.mapping
    csvColumns = [question, source ?? null, notes ?? null]
      .filter((index): index is number => index !== null)
      .map((index) => header[index] ?? `Column ${index + 1}`)
    for (const row of body) {
      const text = row[question] ?? ''
      if (text.trim().length === 0) continue
      csvRows += 1
      const note = [
        source === null || source === undefined ? null : row[source],
        notes === null || notes === undefined ? null : row[notes]
      ]
        .filter(
          (part): part is string => part !== undefined && part !== null && part.trim().length > 0
        )
        .join(' · ')
      lines.push({ text, note: note.length > 0 ? note : null })
    }
  }
  if (lines.length === 0) throw new TopicInputError('Paste questions or pick a CSV column first.')
  const existing =
    request.append === true ? draft.prompts.filter((prompt) => prompt.kind === 'question') : []
  const allLines = [
    ...existing.map((prompt) => ({ text: prompt.text, note: prompt.sourceNote })),
    ...lines
  ]
  const cleaned = cleanImportLines(allLines, draft.brandNames)
  const rows: TopicDraftPrompt[] = cleaned.kept.map((line) => {
    const prior = existing.find((prompt) => prompt.text === line.text)
    const base =
      prior ??
      newDraftPrompt(
        { kind: 'question', text: line.text, source: 'imported', sourceNote: line.sourceNote },
        `tq-${env.host.createId()}`,
        draft.brandNames
      )
    return { ...base, flags: line.flags, mergedFrom: line.mergedFrom }
  })
  const stats = {
    lines: lines.length + existing.length,
    kept: rows.length,
    duplicatesMerged: cleaned.duplicatesMerged,
    brandFlagged: rows.filter((row) => row.flags.includes('brand')).length,
    shortFlagged: rows.filter((row) => row.flags.includes('short')).length
  }
  const next = saveDraft(
    opened.db,
    {
      ...draft,
      step: 'cleanup',
      prompts: [...draft.prompts.filter((prompt) => prompt.kind !== 'question'), ...rows],
      importSource: {
        pastedLines:
          pasted.length + (request.append === true ? (draft.importSource?.pastedLines ?? 0) : 0),
        csvFileName: request.csv?.fileName ?? draft.importSource?.csvFileName ?? null,
        csvRows: csvRows + (request.append === true ? (draft.importSource?.csvRows ?? 0) : 0),
        csvColumns: csvColumns.length > 0 ? csvColumns : (draft.importSource?.csvColumns ?? [])
      },
      importStats: stats
    },
    env.host.now()
  )
  return { draft: next, rows, stats }
}

/** `topics:cleanupWithClaude`: before/after suggestions; Apply goes through updateDraft. */
export async function cleanupWithClaude(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<QuestionCleanupResult> {
  const questions = draft.prompts.filter((prompt) => prompt.kind === 'question')
  if (questions.length === 0) throw new TopicInputError('Add questions first.')
  const reply = await runTopicTemplate<{
    items: { id: string; after: string; stage: TopicStage | null; change: string }[]
  }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: draft.topicId,
    kind: 'topic_questions_cleanup',
    channel: 'topics:cleanupWithClaude',
    context: cleanupContext(opened, draft, questions)
  })
  const byId = new Map(questions.map((prompt) => [prompt.id, prompt]))
  return {
    draftId: draft.id,
    items: reply.value.items
      .filter((item) => byId.has(item.id) && !namesBrand(item.after, draft.brandNames))
      .map((item) => ({
        id: item.id,
        before: byId.get(item.id)?.text ?? '',
        after: item.after.trim(),
        stage: item.stage,
        change: item.change
      })),
    info: reply.info
  }
}
