/**
 * Depth presets for questions and keywords, and the deterministic keyword
 * pattern expansion (Docs/TOPICS-SPEC.md section 3). Pure, so the renderer's
 * Depth settings tab can preview counts with the same rules main uses.
 */

import type {
  DepthPreset,
  KeywordCoreTerm,
  KeywordDepth,
  KeywordIntentFamily,
  QuestionDepth,
  TopicStage
} from './domain'
import {
  KEYWORD_INTENT_FAMILIES,
  MAX_TOPIC_KEYWORDS,
  MAX_TOPIC_QUESTIONS,
  TOPIC_STAGES
} from './domain'

/** Stage weights used to split a question total (Problem and Options get the most). */
const STAGE_WEIGHTS: Readonly<Record<TopicStage, number>> = {
  problem: 6,
  options: 5,
  doubts: 5,
  fit: 5,
  compare: 5,
  decide: 4
}

/** Splits a total over the six stages by weight, largest remainders first. */
export function splitAcrossStages(total: number): Record<TopicStage, number> {
  const clamped = Math.max(0, Math.min(MAX_TOPIC_QUESTIONS, Math.round(total)))
  const weightSum = TOPIC_STAGES.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0)
  const raw = TOPIC_STAGES.map((stage) => ({
    stage,
    exact: (clamped * STAGE_WEIGHTS[stage]) / weightSum
  }))
  const out = Object.fromEntries(raw.map((item) => [item.stage, Math.floor(item.exact)])) as Record<
    TopicStage,
    number
  >
  let left = clamped - Object.values(out).reduce((sum, value) => sum + value, 0)
  for (const item of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left <= 0) break
    out[item.stage] += 1
    left -= 1
  }
  return out
}

export function questionDepthPreset(preset: DepthPreset, custom?: QuestionDepth): QuestionDepth {
  if (preset === 'custom') {
    return { preset, perStage: normalizePerStage(custom?.perStage ?? splitAcrossStages(30)) }
  }
  const total = preset === 'quick' ? 15 : preset === 'deep' ? 60 : 30
  return { preset, perStage: splitAcrossStages(total) }
}

/** Per-stage counts clamped to whole numbers ≥ 0 with a total of at most 100. */
export function normalizePerStage(
  perStage: Readonly<Partial<Record<TopicStage, number>>>
): Record<TopicStage, number> {
  const out = {} as Record<TopicStage, number>
  let total = 0
  for (const stage of TOPIC_STAGES) {
    const value = Math.max(0, Math.round(perStage[stage] ?? 0))
    const allowed = Math.min(value, MAX_TOPIC_QUESTIONS - total)
    out[stage] = allowed
    total += allowed
  }
  return out
}

export function questionTotal(depth: QuestionDepth): number {
  return TOPIC_STAGES.reduce((sum, stage) => sum + depth.perStage[stage], 0)
}

/**
 * The patterns every preset applies. The modifiers buyers of the category really
 * search ("{X} service", "free {X}") come from the core-terms step for each topic
 * (`TopicDraft.keywordPatterns`), so a non-AI product never gets "ai {X} software".
 */
export const DEFAULT_PATTERN_VARIANTS: readonly string[] = ['{X} for {segment}']

const QUICK_FAMILIES: readonly KeywordIntentFamily[] = [
  'core_category',
  'best_lists',
  'pricing',
  'alternatives_vs',
  'how_to'
]

const STANDARD_FAMILIES: readonly KeywordIntentFamily[] = KEYWORD_INTENT_FAMILIES.filter(
  (family) => family !== 'branded_defensive'
)

export function keywordDepthPreset(preset: DepthPreset, custom?: KeywordDepth): KeywordDepth {
  switch (preset) {
    case 'quick':
      return {
        preset,
        maxKeywords: 30,
        synonymsPerCoreTerm: 1,
        patternVariants: DEFAULT_PATTERN_VARIANTS.slice(0, 2),
        longTailQuestions: false,
        intentFamilies: QUICK_FAMILIES,
        perGroupCap: 5
      }
    case 'standard':
      return {
        preset,
        maxKeywords: 120,
        synonymsPerCoreTerm: 3,
        patternVariants: DEFAULT_PATTERN_VARIANTS,
        longTailQuestions: true,
        intentFamilies: STANDARD_FAMILIES,
        perGroupCap: 8
      }
    case 'deep':
      return {
        preset,
        maxKeywords: 400,
        synonymsPerCoreTerm: 6,
        patternVariants: DEFAULT_PATTERN_VARIANTS,
        longTailQuestions: true,
        intentFamilies: KEYWORD_INTENT_FAMILIES,
        perGroupCap: 25
      }
    case 'custom':
      return normalizeKeywordDepth(custom ?? keywordDepthPreset('standard'))
  }
}

export function normalizeKeywordDepth(depth: KeywordDepth): KeywordDepth {
  const clampInt = (value: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, Math.round(Number.isFinite(value) ? value : lo)))
  return {
    preset: depth.preset,
    maxKeywords: clampInt(depth.maxKeywords, 5, MAX_TOPIC_KEYWORDS),
    synonymsPerCoreTerm: clampInt(depth.synonymsPerCoreTerm, 0, 12),
    patternVariants: [
      ...new Set(
        depth.patternVariants
          .map((pattern) => pattern.trim().replace(/\s+/gu, ' '))
          .filter((pattern) => pattern.includes('{X}') && pattern.length <= 80)
      )
    ].slice(0, 20),
    longTailQuestions: depth.longTailQuestions,
    intentFamilies: KEYWORD_INTENT_FAMILIES.filter((family) =>
      depth.intentFamilies.includes(family)
    ),
    perGroupCap: clampInt(depth.perGroupCap, 1, 100)
  }
}

/** One keyword produced in code, before Claude adds intent groups. */
export interface PatternKeyword {
  text: string
  group: string
  /** The core term or synonym it came from. */
  term: string
}

const LONG_TAIL = ['what is {X}', 'how does {X} work', 'how to set up {X}']

/**
 * Coverage groups in code: one group per kept core term and each of its first
 * `synonymsPerCoreTerm` synonyms ("Cover — email to text"), holding the term
 * itself, every pattern variant (one line per segment for `{segment}`), and the
 * long-tail questions when on. Each group stops at `perGroupCap`; the whole list
 * stops at `limit`. Duplicates (case and spacing folded) are dropped.
 */
export function expandPatternKeywords(
  terms: readonly KeywordCoreTerm[],
  depth: KeywordDepth,
  segments: readonly string[],
  limit: number
): PatternKeyword[] {
  const seen = new Set<string>()
  const out: PatternKeyword[] = []
  const segmentWords = segments
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3)
  for (const term of terms) {
    if (!term.kept) continue
    const variants = [term.term, ...term.synonyms.slice(0, depth.synonymsPerCoreTerm)]
    for (const variant of variants) {
      const base = variant.trim().toLowerCase()
      if (base.length === 0) continue
      const group = `Cover — ${base}`
      let inGroup = 0
      const add = (text: string): void => {
        const clean = text.replace(/\s+/gu, ' ').trim().toLowerCase()
        if (clean.length === 0 || seen.has(clean) || inGroup >= depth.perGroupCap) return
        if (out.length >= limit) return
        seen.add(clean)
        inGroup += 1
        out.push({ text: clean, group, term: base })
      }
      add(base)
      const baseWords = new Set(base.split(/\s+/u))
      for (const pattern of depth.patternVariants) {
        // A term that already carries the modifier ("email to text service" and
        // "{X} service") would read "email to text service service": skip it.
        const extra = pattern
          .replace('{X}', ' ')
          .replace('{segment}', ' ')
          .toLowerCase()
          .split(/\s+/u)
          .filter((word) => word.length > 0 && word !== 'for')
        if (extra.length > 0 && extra.every((word) => baseWords.has(word))) continue
        if (pattern.includes('{segment}')) {
          for (const segment of segmentWords) {
            add(pattern.replace('{X}', base).replace('{segment}', segment))
          }
        } else add(pattern.replace('{X}', base))
      }
      if (depth.longTailQuestions)
        for (const pattern of LONG_TAIL) add(pattern.replace('{X}', base))
    }
  }
  return out
}
