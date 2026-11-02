/**
 * The shared importer's vocabulary (deep audit crosscut §5): what each kind of list
 * can bring in, the words a file uses for each column, how stage words translate,
 * and the question-or-keyword rule. Main parses and checks; the renderer shows the
 * same names in its column selects, so both read this one module. Pure.
 */

import { TOPIC_STAGES, type TopicStage } from './domain'

/** What one import brings in. Each has its own columns and its own checks. */
export const IMPORT_ENTITIES = [
  'questions',
  'keywords',
  'pages',
  'competitors',
  'products',
  'markets'
] as const
export type ImportEntity = (typeof IMPORT_ENTITIES)[number]

export function isImportEntity(value: unknown): value is ImportEntity {
  return typeof value === 'string' && (IMPORT_ENTITIES as readonly string[]).includes(value)
}

/** One CiteFox column a file column can be matched to. */
export interface ImportFieldSpec {
  id: string
  label: string
  required?: boolean
  /** Header words that mean this column, folded (lower case, no punctuation). */
  synonyms: readonly string[]
  /** Two example values for the template. */
  examples: readonly [string, string]
}

export const IMPORT_FIELDS: Readonly<Record<ImportEntity, readonly ImportFieldSpec[]>> = {
  questions: [
    {
      id: 'question',
      label: 'Question',
      required: true,
      synonyms: [
        'question',
        'questions',
        'query',
        'queries',
        'prompt',
        'prompts',
        'search',
        'search term',
        'search query',
        'text',
        'keyword',
        'keywords',
        'phrase',
        'buyer question'
      ],
      examples: [
        'my carrier shut down its email to text gateway, what do I use now',
        'is there a replacement for vtext.com email to SMS'
      ]
    },
    {
      id: 'stage',
      label: 'Stage',
      synonyms: [
        'stage',
        'stages',
        'funnel',
        'funnel stage',
        'journey',
        'journey stage',
        'buyer stage',
        'intent',
        'step'
      ],
      examples: ['Problem', 'Options']
    },
    {
      id: 'page',
      label: 'Page to be cited',
      synonyms: [
        'page',
        'url',
        'landing page',
        'target',
        'target page',
        'target url',
        'page url',
        'link',
        'page to be cited',
        'cited page',
        'address'
      ],
      examples: ['/email-to-sms/', '/email-to-sms/']
    },
    {
      id: 'market',
      label: 'Market',
      synonyms: ['market', 'markets', 'geo', 'country', 'location', 'region', 'locale'],
      examples: ['US', 'US']
    },
    {
      id: 'topic',
      label: 'Topic',
      synonyms: ['topic', 'topics', 'cluster', 'category', 'theme'],
      examples: ['', '']
    },
    {
      id: 'tags',
      label: 'Tags',
      synonyms: ['tags', 'tag', 'labels', 'notes', 'note', 'source'],
      examples: ['support emails', 'sales call']
    }
  ],
  keywords: [
    {
      id: 'keyword',
      label: 'Keyword',
      required: true,
      synonyms: ['keyword', 'keywords', 'query', 'queries', 'search term', 'term', 'phrase'],
      examples: ['email to sms gateway', 'vtext replacement']
    },
    {
      id: 'page',
      label: 'Page to be cited',
      synonyms: ['page', 'url', 'landing page', 'target', 'target url', 'page url'],
      examples: ['/email-to-sms/', '/email-to-sms/']
    },
    {
      id: 'market',
      label: 'Market',
      synonyms: ['market', 'geo', 'country', 'location', 'locale'],
      examples: ['US', 'US']
    },
    {
      id: 'tags',
      label: 'Tags',
      synonyms: ['tags', 'tag', 'group', 'notes', 'note', 'volume', 'monthly volume'],
      examples: ['gateway', 'carrier']
    }
  ],
  pages: [
    {
      id: 'url',
      label: 'Page URL',
      required: true,
      synonyms: ['url', 'urls', 'page', 'page url', 'address', 'link', 'loc', 'landing page'],
      examples: ['https://example.com/pricing/', '/email-to-sms/']
    },
    {
      id: 'label',
      label: 'Label',
      synonyms: ['label', 'name', 'title', 'page title', 'page name'],
      examples: ['Pricing', 'Email to SMS']
    }
  ],
  competitors: [
    {
      id: 'domain',
      label: 'Website',
      required: true,
      synonyms: ['domain', 'website', 'site', 'url', 'competitor url', 'homepage'],
      examples: ['simpletexting.com', 'twilio.com']
    },
    {
      id: 'name',
      label: 'Name',
      synonyms: ['name', 'competitor', 'company', 'brand', 'competitor name'],
      examples: ['SimpleTexting', 'Twilio']
    },
    {
      // A product name of the project; blank or unknown competes with the whole business.
      id: 'competes_with',
      label: 'Competes with',
      synonyms: ['competes with', 'competes against', 'our product', 'rival of'],
      examples: ['Email to SMS', '']
    }
  ],
  products: [
    {
      id: 'name',
      label: 'Product',
      required: true,
      synonyms: ['product', 'products', 'name', 'product name', 'service'],
      examples: ['Email to SMS', 'Text alerts']
    },
    {
      id: 'job',
      label: 'What it does',
      synonyms: ['job', 'what it does', 'description', 'use', 'use case'],
      examples: ['send texts from email', 'alert a team by text']
    },
    {
      id: 'buyer',
      label: 'Who buys it',
      synonyms: ['buyer', 'who buys it', 'audience', 'customer', 'segment'],
      examples: ['small offices', 'facilities teams']
    },
    {
      id: 'url',
      label: 'Page',
      synonyms: ['url', 'page', 'link', 'path'],
      examples: ['/email-to-sms/', '/text-alerts/']
    }
  ],
  markets: [
    {
      id: 'country',
      label: 'Country',
      required: true,
      synonyms: ['country', 'market', 'geo', 'region', 'country code', 'gl'],
      examples: ['US', 'GB']
    },
    {
      id: 'language',
      label: 'Language',
      synonyms: ['language', 'lang', 'hl', 'locale'],
      examples: ['en', 'en']
    },
    {
      id: 'location',
      label: 'City or area',
      synonyms: ['location', 'city', 'area', 'state'],
      examples: ['', 'London']
    },
    {
      id: 'device',
      label: 'Device',
      synonyms: ['device'],
      examples: ['desktop', 'mobile']
    }
  ]
}

/** One noun per entity: "1 question", "3 questions". */
export const IMPORT_NOUN: Readonly<Record<ImportEntity, readonly [string, string]>> = {
  questions: ['question', 'questions'],
  keywords: ['keyword', 'keywords'],
  pages: ['page', 'pages'],
  competitors: ['competitor', 'competitors'],
  products: ['product', 'products'],
  markets: ['market', 'markets']
}

/** The field that holds a row's main value (the question, the URL, the domain…). */
export function mainField(entity: ImportEntity): string {
  return IMPORT_FIELDS[entity][0]?.id ?? 'text'
}

export function fieldSpec(entity: ImportEntity, id: string): ImportFieldSpec | null {
  return IMPORT_FIELDS[entity].find((field) => field.id === id) ?? null
}

/** Lower case, accents folded, punctuation dropped, spaces squeezed: how header and stage words compare. */
export function foldWord(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Stage words every import understands: the six journey stages, the page intent
 * stages they come from, and the funnel words most keyword tools use. Anything
 * else ("Awareness") is asked once and can be saved with the column match.
 */
export const BUILT_IN_STAGE_WORDS: Readonly<Record<string, TopicStage>> = {
  ...Object.fromEntries(TOPIC_STAGES.map((stage) => [stage, stage])),
  solution: 'options',
  solutions: 'options',
  comparison: 'compare',
  objection: 'doubts',
  objections: 'doubts',
  trigger: 'decide',
  tofu: 'problem',
  mofu: 'compare',
  bofu: 'decide',
  'top of funnel': 'problem',
  'middle of funnel': 'compare',
  'bottom of funnel': 'decide'
}

/** Words the file used for stages, mapped to a stage (null: asked, not chosen yet). */
export type ImportStageWords = Readonly<Record<string, TopicStage | null>>

/**
 * A stage cell as a stage: the user's own words first, then the built-in words.
 * `''` for an empty cell; `unknown` when nobody has said what the word means yet.
 */
export function translateStage(raw: string, words: ImportStageWords): TopicStage | '' | 'unknown' {
  const key = foldWord(raw)
  if (key.length === 0 || key === 'none' || key === 'unset') return ''
  const own = words[key]
  if (own !== undefined) return own ?? 'unknown'
  return BUILT_IN_STAGE_WORDS[key] ?? 'unknown'
}

/** A phrase this short with no question shape is searched as a keyword (TOPICS-SPEC §3). */
export const KEYWORD_MAX_WORDS = 4

const QUESTION_START =
  /^(?:how|what|which|who|whom|whose|why|when|where|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|has|have|any|best way)\b/iu

export function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

/** True when the text reads as a question: a question mark, or it starts with a question word. */
export function questionShaped(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.endsWith('?') || QUESTION_START.test(trimmed)
}

/**
 * `keyword` for a short phrase without a question shape ("email to sms gateway"),
 * else `question`. Topics search keywords apart from questions.
 */
export function promptKindOf(text: string): 'question' | 'keyword' {
  return wordCount(text) <= KEYWORD_MAX_WORDS && !questionShaped(text) ? 'keyword' : 'question'
}

/** "A", "B", … "Z", "AA": the spreadsheet letter of a column. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    out = String.fromCharCode(65 + rest) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
