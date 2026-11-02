import { cleanHost } from '@shared/competitor-hosts'
import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import { bareDomain } from '@shared/own-site'
import { pathOf } from '../context'
import type { HelpFillKindDef, HelpFillSection, HelpFillValues } from '../types'
import { cleanMarket, marketKey } from './markets'
import { cleanQuestion } from './questions'

/**
 * New project → "Use my own ChatGPT": the whole setup from one prompt. The
 * chatbot visits the site and replies with five `### SECTION` blocks, each a CSV:
 * products, buyers, competitors, markets and buyer questions. Products,
 * competitors, markets and questions take their header words from IMPORT_FIELDS.
 * The renderer turns the rows into the Fill card (the same one "Read my website"
 * fills) and the questions into topics; nothing is saved before Create project.
 * There is no Describe: the in-app way is `projects:fillFromWebsite`.
 */

const PRODUCTS: HelpFillSection = {
  id: 'products',
  title: 'PRODUCTS',
  synonyms: ['offerings', 'services', 'what it sells'],
  columns: ['name', 'url', 'job'],
  entity: 'products'
}

const BUYERS: HelpFillSection = {
  id: 'buyers',
  title: 'BUYERS',
  synonyms: ['buyer types', 'audience', 'customers', 'segments', 'who buys'],
  columns: ['who', 'problem', 'trigger', 'product'],
  entity: null
}

const COMPETITORS: HelpFillSection = {
  id: 'competitors',
  title: 'COMPETITORS',
  synonyms: ['competitor', 'rivals', 'alternatives'],
  columns: ['name', 'domain', 'competes_with'],
  entity: 'competitors'
}

const MARKETS: HelpFillSection = {
  id: 'markets',
  title: 'MARKETS',
  synonyms: ['market', 'countries', 'where it sells'],
  columns: ['country', 'language', 'city'],
  entity: 'markets',
  fields: { city: 'location' }
}

const QUESTIONS: HelpFillSection = {
  id: 'questions',
  title: 'QUESTIONS',
  synonyms: ['question', 'buyer questions', 'prompts'],
  columns: ['question', 'stage', 'product'],
  entity: 'questions',
  neutral: true
}

export const PROJECT_SECTIONS: readonly HelpFillSection[] = [
  PRODUCTS,
  BUYERS,
  COMPETITORS,
  MARKETS,
  QUESTIONS
]

export const PROJECT_KIND: HelpFillKindDef = {
  kind: 'project',
  noun: ['item', 'items'],
  scope: 'project',
  sections: PROJECT_SECTIONS,
  neutral: false,
  defaultCount: 24,
  maxCount: 24,
  // Buyer questions the prompt asks for (board: 24 questions, about 3 topics).
  chatbotCount: 24,
  describeCost: { calls: 0, usd: 0 },
  role: (context) => `You help set up AI-search tracking for ${context.domain}.`,
  task(context, count) {
    const brands = context.brands.length > 0 ? context.brands.join(' or ') : 'the company'
    return [
      `Visit ${context.domain} and read its main pages (home, pricing, product pages) before you answer.`,
      'PRODUCTS: up to 5 products or services it sells. name = a short name; url = its page path (/pricing/) or blank; job = what it does for the buyer, in one line.',
      'BUYERS: 2 to 4 kinds of buyer. who = a role, company size or industry; problem = what goes wrong for them; trigger = what makes them look now; product = a name from PRODUCTS.',
      'COMPETITORS: up to 10 live products a buyer could choose instead today. domain = a bare host (example.com); competes_with = a name from PRODUCTS. Leave out tools it works with.',
      'MARKETS: the countries it sells in, the main one first. country = a two-letter code (US); language = a two-letter code (en); city = blank unless it sells in one city.',
      `QUESTIONS: ${count} questions buyers type into Google before they know ${brands}: a situation plus a need, in full sentences. Never name ${brands}. Mix the stages.`,
      `stage = ${TOPIC_STAGES.map((stage) => TOPIC_STAGE_LABEL[stage]).join(' | ')}`,
      'product = a name from PRODUCTS'
    ]
  },
  tracked: (context) => ({ listed: [], merge: { questions: context.projectQuestions } }),
  key(values, section) {
    if (section.id === 'competitors') return values.domain || values.name || ''
    if (section.id === 'markets') return marketKey(values)
    return values[section.columns[0] ?? ''] ?? ''
  },
  clean: (values, context, section) => cleanSetupRow(values, section, context.domain)
}

/** One row of a setup reply, tidied per section. Null drops it. */
export function cleanSetupRow(
  values: HelpFillValues,
  section: HelpFillSection,
  domain: string
): HelpFillValues | null {
  const cell = (id: string): string => (values[id] ?? '').trim()
  switch (section.id) {
    case 'products': {
      const name = cell('name')
      if (name.length < 2) return null
      const url = cell('url')
      return { name, url: url.length === 0 ? '' : pathOf(url) || url, job: cell('job') }
    }
    case 'buyers': {
      const who = cell('who')
      if (who.length < 2) return null
      return { who, problem: cell('problem'), trigger: cell('trigger'), product: cell('product') }
    }
    case 'competitors':
      return cleanCompetitor(values, domain)
    case 'markets':
      return cleanMarket(values)
    case 'questions': {
      const question = cleanQuestion({ question: cell('question'), stage: cell('stage'), page: '' })
      if (question === null) return null
      return {
        question: question.question ?? '',
        stage: question.stage ?? '',
        product: cell('product')
      }
    }
    default:
      return values
  }
}

/** A bare host (or '' when the cell is not one), a name, and never the site itself. */
function cleanCompetitor(values: HelpFillValues, domain: string): HelpFillValues | null {
  const raw = (values.domain ?? '').trim()
  const host = cleanHost(raw)
  const domainOk = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(host)
  const own = bareDomain(domain)
  if (domainOk && own.length > 0 && (host === own || host.endsWith(`.${own}`))) return null
  const name = (values.name ?? '').trim() || (domainOk ? host : '')
  if (name.length === 0) return null
  return {
    name,
    domain: domainOk ? host : '',
    competes_with: (values.competes_with ?? '').trim()
  }
}
