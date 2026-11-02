/**
 * Sample data for the mock step list and Try it: output fields per kind (pretty
 * JSON schema text, as `templates:steps` returns it), the values a draft renders
 * with, and Claude's canned answer per kind. Taken from Templates.dc.html.
 */

function pretty(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
}

const text = { type: 'string', minLength: 1 }

export const STEP_SCHEMAS: Readonly<Record<string, string>> = {
  buyer_profile: pretty({
    type: 'object',
    required: ['who', 'environment', 'segments', 'triggers', 'values', 'poorFit'],
    properties: {
      who: text,
      environment: text,
      segments: { type: 'array', items: { type: 'object' } },
      triggers: { type: 'array', items: text },
      values: { type: 'array', items: text },
      poorFit: { type: 'array', items: { type: 'object' } }
    }
  }),
  buyer_prompts: pretty({
    type: 'object',
    required: ['prompts'],
    properties: {
      prompts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text', 'label', 'source', 'intentStage', 'mappedElement'],
          properties: {
            text: { type: 'string', maxLength: 240 },
            label: text,
            source: { enum: ['title_meta_h1', 'trigger_event', 'objection', 'detail_check'] },
            intentStage: { enum: ['problem', 'solution', 'comparison', 'objection', 'trigger'] },
            mappedElement: text
          }
        }
      }
    }
  }),
  coverage: pretty({
    type: 'object',
    required: ['rows', 'findings'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['position', 'coverage', 'currentContent', 'whatToUpdate', 'suggestedFaq'],
          properties: {
            position: { type: 'integer' },
            coverage: { enum: ['strong', 'partial', 'weak', 'none'] },
            currentContent: text,
            whatToUpdate: text,
            suggestedFaq: { type: ['object', 'null'] }
          }
        }
      },
      findings: { type: 'array', items: { type: 'object' } }
    }
  }),
  coverage_matrix: pretty({
    type: 'object',
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['position', 'coverage', 'whereCovered', 'mainGap', 'priority', 'actions'],
          properties: {
            position: { type: 'integer' },
            coverage: { enum: ['strong', 'partial', 'weak', 'none'] },
            whereCovered: { type: 'array', items: text },
            mainGap: text,
            priority: { enum: ['high', 'medium', 'low'] },
            actions: { type: 'array', items: text }
          }
        }
      }
    }
  }),
  page_audit: pretty({
    type: 'object',
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'quote', 'text', 'correction', 'verify'],
          properties: {
            type: {
              enum: [
                'title_meta_mismatch',
                'factual_claim',
                'missing_promised_section',
                'typo',
                'other'
              ]
            },
            quote: text,
            text: { type: 'string', maxLength: 200 },
            correction: { type: ['string', 'null'] },
            verify: { type: ['string', 'null'] }
          }
        }
      }
    }
  }),
  coverage_fixes: pretty({
    type: 'object',
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['position', 'currentContent', 'whatToUpdate', 'suggestedFaq'],
          properties: {
            position: { type: 'integer' },
            currentContent: text,
            whatToUpdate: text,
            suggestedFaq: { type: 'object' }
          }
        }
      }
    }
  }),
  aio_gap: pretty({
    type: 'object',
    required: ['facts'],
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['fact', 'likelySource'],
          properties: { fact: text, likelySource: { type: ['string', 'null'] } }
        }
      }
    }
  }),
  answer_shape: pretty({
    type: 'object',
    required: ['blocks'],
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'excerpt'],
          properties: { code: text, excerpt: { type: 'string', maxLength: 160 } }
        }
      }
    }
  }),
  run_summary: pretty({
    type: 'object',
    required: ['headline', 'body'],
    properties: { headline: text, body: text }
  })
}

export const TRY_SAMPLE_VALUES: Readonly<Record<string, string>> = {
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'How to Set Up Text Alerts for Business',
  meta_description: 'Send text alerts to staff from Gmail or Outlook. No developer required.',
  h1: 'Text alerts for business',
  page_text: 'TextBolt sends text alerts from email. No developer required.',
  brand_name: 'TextBolt',
  prompt_count: '10',
  outline: 'H2 Method 1 · H2 Method 2 · H2 FAQs',
  faqs: 'Do I need 10DLC registration?',
  last_modified: 'Oct 16, 2026',
  prompt_text: 'How can I send text alerts to my employees without hiring a developer?',
  overview_text:
    'Text alerts let a business message staff by SMS. You can send them from email with a gateway.'
}

export const TRY_OUTPUTS: Readonly<Record<string, string>> = {
  buyer_profile: pretty({
    who: 'Operations managers and office managers at US businesses with 10 to 250 staff. No developer on call.',
    environment: 'They live in Gmail or Outlook and a monitoring tool that only sends email.',
    segments: [{ name: 'Field service', reason: 'Crews need texts, not email.' }],
    triggers: ['A carrier email-to-text address stopped delivering'],
    values: ['No developer needed'],
    poorFit: [{ name: 'SMS marketers', reason: 'The page is about staff alerts.' }]
  }),
  buyer_prompts: pretty({
    prompts: [
      {
        text: 'How can I send text alerts to my employees without hiring a developer or learning a new app?',
        label: 'No developer',
        source: 'title_meta_h1',
        intentStage: 'problem',
        mappedElement: 'H1'
      }
    ]
  }),
  coverage: pretty({
    rows: [
      {
        position: 1,
        coverage: 'partial',
        currentContent: 'The carrier FAQ gives shutdown dates.',
        whatToUpdate: 'Add the migration step.',
        suggestedFaq: null
      }
    ],
    findings: []
  }),
  coverage_matrix: pretty({
    rows: [
      {
        position: 1,
        coverage: 'partial',
        whereCovered: [
          'What should businesses use instead of txt.att.net or vtext.com for alerts?'
        ],
        mainGap: 'No step for moving an alarm panel off the old carrier address.',
        priority: 'high',
        actions: ['update_existing', 'new_faq']
      }
    ]
  }),
  page_audit: pretty({
    findings: [
      {
        type: 'factual_claim',
        quote: 'A standard SMS supports up to 155 characters',
        text: 'A single GSM-7 SMS segment holds 160 characters, not 155.',
        correction: 'A single GSM-7 SMS segment holds up to 160 characters.',
        verify: '3GPP TS 23.038'
      }
    ]
  }),
  coverage_fixes: pretty({
    rows: [
      {
        position: 1,
        currentContent: 'The carrier FAQ says the old gateways are being discontinued.',
        whatToUpdate: 'Add the migration step to the carrier FAQ.',
        suggestedFaq: {
          question: 'Our alarm panel emails a vtext.com address. What do I change it to?',
          answer: 'Point the panel at a gateway address that turns each email into a text.'
        }
      }
    ]
  }),
  aio_gap: pretty({
    facts: [
      {
        fact: 'Verizon is phasing out email delivery to vtext.com addresses.',
        likelySource: 'verizon.com'
      }
    ]
  }),
  answer_shape: pretty({
    blocks: [
      { code: 'A1', excerpt: 'Text alerts let a business message staff by SMS.' },
      { code: 'C1', excerpt: 'You can send them from email with a gateway.' }
    ]
  }),
  run_summary: pretty({
    headline: 'The AI Overview now cites this page for 3 of 8 prompts, up from 2.',
    body: 'The page content changed between these checks.'
  })
}
