import {
  KEYWORD_INTENT_FAMILIES,
  type DepthPreset,
  type KeywordDepth,
  type KeywordIntent,
  type TopicWizardPath,
  type TopicWizardStep
} from '@shared/domain'
import type { WizardStepDef } from './types'

export const QUESTION_DEPTH_LINE: Readonly<Record<DepthPreset, string>> = {
  quick: '15 questions · 2–3 per stage',
  standard: '30 questions · about 5 per stage',
  deep: '60 questions · about 10 per stage',
  custom: 'Set a limit for each stage'
}

export const MAX_PER_STAGE = 30

export const KEYWORD_DEPTH_LINE: Readonly<Record<DepthPreset, string>> = {
  quick: 'Core terms and top intent groups · about 30 keywords',
  standard: 'All intent groups plus your main synonyms · about 100–120',
  deep: 'More synonyms, variants and long-tail · about 250–500',
  custom: 'Set synonyms, caps and patterns yourself'
}

/**
 * Pattern variants offered on Depth settings (spec §3). `{X}` is a core term or
 * synonym. Presets apply only "{X} for {segment}"; the modifiers buyers of the
 * category search come from Discover core terms. The AI ones are opt-in, for AI products.
 */
export const PATTERN_CHOICES: readonly string[] = [
  '{X} for {segment}',
  '{X} service',
  '{X} for business',
  'best {X}',
  '{X} app',
  'free {X}',
  '{X} for small business',
  'ai {X} software',
  'automated {X} software',
  '{X} automation',
  'ai-powered {X}'
]

/** What every preset applies (main's `DEFAULT_PATTERN_VARIANTS`). */
const PRESET_PATTERNS: readonly string[] = ['{X} for {segment}']

/** Settings each keyword preset stands for. Custom starts from the current settings. */
export const KEYWORD_PRESETS: Readonly<
  Record<Exclude<DepthPreset, 'custom'>, Omit<KeywordDepth, 'preset'>>
> = {
  quick: {
    maxKeywords: 30,
    synonymsPerCoreTerm: 1,
    patternVariants: PRESET_PATTERNS,
    longTailQuestions: false,
    intentFamilies: ['definitional', 'core_category', 'best_lists', 'pricing', 'alternatives_vs'],
    perGroupCap: 5
  },
  standard: {
    maxKeywords: 120,
    synonymsPerCoreTerm: 3,
    patternVariants: PRESET_PATTERNS,
    longTailQuestions: true,
    intentFamilies: KEYWORD_INTENT_FAMILIES,
    perGroupCap: 7
  },
  deep: {
    maxKeywords: 500,
    synonymsPerCoreTerm: 6,
    patternVariants: PRESET_PATTERNS,
    longTailQuestions: true,
    intentFamilies: KEYWORD_INTENT_FAMILIES,
    perGroupCap: 30
  }
}

export const INTENT_LABEL: Readonly<Record<KeywordIntent, string>> = {
  informational: 'Informational',
  commercial: 'Commercial',
  navigational: 'Navigational'
}

const SEED_STEPS: readonly WizardStepDef[] = [
  { id: 'seed', label: 'Seed' },
  { id: 'profile', label: 'Buyer profile' },
  { id: 'questions', label: 'Questions' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'pages', label: 'Pages' },
  { id: 'estimate', label: 'Estimate' }
]

const IMPORT_STEPS: readonly WizardStepDef[] = [
  { id: 'import', label: 'Add questions' },
  { id: 'cleanup', label: 'Clean up' },
  { id: 'pages', label: 'Pages' },
  { id: 'estimate', label: 'Estimate' }
]

const COMPETITOR_STEPS: readonly WizardStepDef[] = [
  { id: 'competitor', label: 'Their page' },
  { id: 'questions', label: 'Questions' },
  { id: 'pages', label: 'Pages' },
  { id: 'estimate', label: 'Estimate' }
]

export const PATH_STEPS: Readonly<Record<TopicWizardPath, readonly WizardStepDef[]>> = {
  seed: SEED_STEPS,
  questions: IMPORT_STEPS,
  competitor: COMPETITOR_STEPS
}

export const FIRST_STEP: Readonly<Record<TopicWizardPath, TopicWizardStep>> = {
  seed: 'seed',
  questions: 'import',
  competitor: 'competitor'
}

export const PATH_CRUMB: Readonly<Record<TopicWizardPath, string>> = {
  seed: 'New topic',
  questions: 'My own questions',
  competitor: 'Competitor page'
}

export const WRITER_NAME = '1000AIOverviews'

/** Searches one prompt can use in one market. */
export const SEARCHES_PER_PROMPT = { low: 1, high: 2 } as const
