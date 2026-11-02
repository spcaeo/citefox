import type { IntentStage, PromptCheckStatus, PromptMovement } from '@shared/domain'

/**
 * Words for the Ask CiteFox filter values: the chip label, and the meaning
 * Claude reads in the prompt. Keyed by every value, so a new status fails the
 * typecheck here instead of showing a raw code.
 */
interface Word {
  label: string
  meaning: string
}

export const STATUS_WORDS = {
  page_cited: { label: 'Page cited', meaning: 'the AI Overview cites this page' },
  other_own_page: {
    label: 'Other own page',
    meaning: 'the AI Overview cites another page on the same site instead'
  },
  brand_mentioned: {
    label: 'Brand mentioned',
    meaning: 'the AI Overview names the brand but does not link this page'
  },
  not_cited: {
    label: 'Not cited',
    meaning: 'the AI Overview shows but cites neither this page nor the brand'
  },
  no_aio: { label: 'No AI Overview', meaning: 'Google showed no AI Overview for the prompt' },
  error: { label: 'Error', meaning: 'the capture failed after retries' }
} as const satisfies Record<PromptCheckStatus, Word>

export const MOVEMENT_WORDS = {
  gained: { label: 'Gained since last check', meaning: 'newly cited since the previous check' },
  lost: { label: 'Lost since last check', meaning: 'cited on the previous check, not now' },
  improved: {
    label: 'Moved up since last check',
    meaning: 'still cited, at a better position than the previous check'
  },
  declined: {
    label: 'Moved down since last check',
    meaning: 'still cited, at a worse position, or a weaker status, than the previous check'
  },
  unchanged: { label: 'Unchanged since last check', meaning: 'same result as the previous check' }
} as const satisfies Record<PromptMovement, Word>

export const STAGE_WORDS = {
  problem: { label: 'Problem', meaning: 'the buyer describes a problem' },
  solution: { label: 'Solution', meaning: 'the buyer looks for a kind of solution' },
  comparison: { label: 'Comparison', meaning: 'the buyer compares options or vendors' },
  objection: { label: 'Objection', meaning: 'the buyer checks a doubt, cost, or risk' },
  trigger: { label: 'Trigger', meaning: 'an event pushed the buyer to search' },
  unset: { label: 'Unset', meaning: 'a prompt the user has not classified' }
} as const satisfies Record<IntentStage, Word>

export const STATUS_VALUES = Object.keys(STATUS_WORDS) as PromptCheckStatus[]
export const MOVEMENT_VALUES = Object.keys(MOVEMENT_WORDS) as PromptMovement[]
export const STAGE_VALUES = Object.keys(STAGE_WORDS) as IntentStage[]
