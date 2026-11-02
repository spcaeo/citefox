/** JSON schemas for the three M2 Claude steps. Field names match the shared types. */

/**
 * Bounds for one buyer prompt (FR-8.3). A buyer prompt is a long situational
 * question, often in the first person, so there is no first-person rule.
 * Eight words is the floor: "sms alert software for small business", the
 * short keyword prompt the method rejects, is six. Google reads at most 32
 * words of a query and ignores the rest, so a longer prompt would not be
 * checked as written. 400 characters fits 32 long words and stops a pasted
 * paragraph. An out-of-bounds prompt is rejected. Nothing truncates it.
 */
export const BUYER_PROMPT_MIN_WORDS = 8
export const BUYER_PROMPT_MAX_WORDS = 32
export const BUYER_PROMPT_MAX_CHARS = 400

const namedReason = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'reason'],
  properties: {
    name: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 }
  }
}

export const BUYER_PROFILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['who', 'environment', 'segments', 'triggers', 'values', 'poorFit'],
  properties: {
    who: { type: 'string', minLength: 1 },
    environment: { type: 'string', minLength: 1 },
    segments: { type: 'array', minItems: 1, items: namedReason },
    triggers: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    values: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    poorFit: { type: 'array', minItems: 1, items: namedReason }
  }
}

export const BUYER_PROMPTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['prompts'],
  properties: {
    prompts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'label', 'source', 'intentStage', 'mappedElement'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: BUYER_PROMPT_MAX_CHARS },
          label: { type: 'string', minLength: 1 },
          source: {
            type: 'string',
            enum: ['title_meta_h1', 'trigger_event', 'objection', 'detail_check', 'written_by_user']
          },
          intentStage: {
            type: 'string',
            enum: ['problem', 'solution', 'comparison', 'objection', 'trigger', 'unset']
          },
          mappedElement: { type: 'string', minLength: 1 }
        }
      }
    }
  }
}

export const COVERAGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'findings'],
  properties: {
    rows: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'position',
          'coverage',
          'whereCovered',
          'currentContent',
          'whatToUpdate',
          'mainGap',
          'priority',
          'actions',
          'suggestedFaq'
        ],
        properties: {
          position: { type: 'integer', minimum: 1 },
          coverage: { type: 'string', enum: ['strong', 'partial', 'weak', 'none'] },
          whereCovered: { type: 'array', items: { type: 'string', minLength: 1 } },
          currentContent: { type: 'string', minLength: 1 },
          whatToUpdate: { type: 'string', minLength: 1 },
          mainGap: { type: 'string', minLength: 1 },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          actions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'string',
              enum: ['update_existing', 'new_faq', 'small_update', 'optional_faq', 'none']
            }
          },
          suggestedFaq: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['question', 'answer'],
                properties: {
                  question: { type: 'string', minLength: 1 },
                  answer: { type: 'string', minLength: 1 }
                }
              }
            ]
          }
        }
      }
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'summary', 'detail'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'factual_claim',
              'missing_promised_section',
              'typo',
              'title_length',
              'title_meta_mismatch',
              'other'
            ]
          },
          summary: { type: 'string', minLength: 1 },
          detail: { type: 'string', minLength: 1 }
        }
      }
    }
  }
}

const coverageLevel = { type: 'string', enum: ['strong', 'partial', 'weak', 'none'] }

const coverageActions = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'string',
    enum: ['update_existing', 'new_faq', 'small_update', 'optional_faq', 'none']
  }
}

/** Longest page quote a finding or a place may carry. Storage keeps places to 300. */
export const PAGE_QUOTE_MAX_CHARS = 300

/** Longest one-line finding text. Storage keeps a finding summary to 200. */
export const FINDING_TEXT_MAX_CHARS = 200

/**
 * `coverage_matrix` (Docs/PROMPT-AUDIT.md, P1 3a): the rating only, one row per
 * prompt in the batch. Fixes and page-wide findings are other steps.
 */
export const COVERAGE_MATRIX_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'coverage', 'whereCovered', 'mainGap', 'priority', 'actions'],
        properties: {
          position: { type: 'integer', minimum: 1 },
          coverage: coverageLevel,
          whereCovered: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: PAGE_QUOTE_MAX_CHARS }
          },
          mainGap: { type: 'string', minLength: 1 },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          actions: coverageActions
        }
      }
    }
  }
}

/** `page_audit` (P1 3b): page-wide findings, each quoted from the page. */
export const PAGE_AUDIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text', 'quote', 'correction', 'verify'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'title_meta_mismatch',
              'factual_claim',
              'missing_promised_section',
              'typo',
              'other'
            ]
          },
          text: { type: 'string', minLength: 1, maxLength: FINDING_TEXT_MAX_CHARS },
          quote: { type: 'string', minLength: 1, maxLength: PAGE_QUOTE_MAX_CHARS },
          correction: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
          verify: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] }
        }
      }
    }
  }
}

/**
 * `coverage_fixes` (P1 3c): what is there now, what to update and a new FAQ, for
 * rows rated partial, weak or none. Every such row gets a FAQ draft.
 */
export const COVERAGE_FIXES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'currentContent', 'whatToUpdate', 'suggestedFaq'],
        properties: {
          position: { type: 'integer', minimum: 1 },
          currentContent: { type: 'string', minLength: 1 },
          whatToUpdate: { type: 'string', minLength: 1 },
          suggestedFaq: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'answer'],
            properties: {
              question: { type: 'string', minLength: 1, maxLength: 300 },
              answer: { type: 'string', minLength: 1 }
            }
          }
        }
      }
    }
  }
}
