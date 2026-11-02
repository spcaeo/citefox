import { isTopicStage, type TopicStage } from '@shared/domain'
import type {
  CompetitorSuggestion,
  CreateTopicsRequest,
  FillFromWebsiteResult,
  HelpFillResult,
  HelpFillRow,
  ProductSuggestion,
  SuggestedMarket
} from '@shared/ipc'

/**
 * New project → "Use my own ChatGPT": the chatbot's five sections as what the
 * form already knows how to review. Products, buyers, competitors and the first
 * market become a Fill read (the card "Read my website" fills, with its tabs and
 * Add buttons); the buyer questions become a topics plan, one topic per product,
 * created after Create project. Pure; nothing is saved here.
 */

/** Most topics and questions per topic `topics:createTopics` takes. */
const MAX_TOPICS = 12
const MAX_TOPIC_QUESTIONS = 40
/** The topic for questions that name no product. */
const GENERAL = 'General'

export interface SetupPlanQuestion {
  id: string
  text: string
  stage: TopicStage
  /** Ticked: created with its topic. */
  keep: boolean
}

export interface SetupPlanTopic {
  id: string
  /** A product name, or "General". */
  name: string
  /** The buyer problem the topic starts from (a buyer's problem, else the product's job). */
  situation: string
  questions: readonly SetupPlanQuestion[]
}

/** What the answer holds beyond the Fill read: the markets and the topics plan. */
export interface SetupPlan {
  markets: readonly SuggestedMarket[]
  topics: readonly SetupPlanTopic[]
}

export interface SetupDraft {
  fill: FillFromWebsiteResult
  plan: SetupPlan
}

const FROM_ANSWER = 'From your chatbot’s answer.'

export function draftFromAnswer(result: HelpFillResult, domain: string): SetupDraft {
  const rows = (section: string): HelpFillRow[] =>
    result.rows.filter((row) => row.section === section)
  const value = (row: HelpFillRow, id: string): string => (row.values[id] ?? '').trim()
  const buyers = rows('buyers')
  const named = rows('products').map((row, index) => ({
    id: `answer-product-${index + 1}`,
    name: value(row, 'name'),
    job: value(row, 'job'),
    url: value(row, 'url')
  }))
  const productOf = (written: string): (typeof named)[number] | null => {
    const key = fold(written)
    if (key.length === 0) return named.length === 1 ? (named[0] ?? null) : null
    return named.find((item) => fold(item.name) === key) ?? null
  }
  // Buyers naming no known product go with the first one, so the Buyers tab shows them.
  const buyersOf = new Map<string, HelpFillRow[]>()
  for (const row of buyers) {
    const product = productOf(value(row, 'product')) ?? named[0] ?? null
    if (product === null) continue
    buyersOf.set(product.id, [...(buyersOf.get(product.id) ?? []), row])
  }
  const products: ProductSuggestion[] = named.map((item) => ({
    id: item.id,
    name: item.name,
    job: item.job,
    buyer: (buyersOf.get(item.id) ?? []).map((row) => value(row, 'who')).join('; '),
    evidence: item.url.startsWith('/') ? { path: item.url, quote: FROM_ANSWER } : null,
    searchNote: null
  }))
  const competitors: CompetitorSuggestion[] = rows('competitors').map((row, index) => {
    const host = value(row, 'domain')
    const product = productOf(value(row, 'competes_with'))
    return {
      id: `answer-competitor-${index + 1}`,
      name: value(row, 'name') || host,
      domain: host.length > 0 ? host : null,
      domainSource: host.length > 0 ? 'search' : null,
      reason: product === null ? FROM_ANSWER : `Competes with ${product.name}.`,
      evidence: null,
      checkDomain: false,
      product: product?.id ?? named[0]?.id ?? null,
      tier: 'direct',
      startingPrice: null,
      sources: []
    }
  })
  const markets: SuggestedMarket[] = rows('markets').map((row, index) => ({
    country: value(row, 'country'),
    language: value(row, 'language') || 'en',
    location: value(row, 'city') || null,
    reason: index === 0 ? 'The main market in your chatbot’s answer.' : FROM_ANSWER
  }))
  const fill: FillFromWebsiteResult = {
    domain,
    pagesRead: [],
    summary: null,
    products,
    brands: [],
    competitors,
    switchingFrom: [],
    integrations: [],
    suggestedMarket: markets[0] ?? null,
    message:
      'Read from your chatbot’s answer. Add what fits; nothing is saved until you create the project.',
    nextStep: null
  }
  return { fill, plan: { markets, topics: topicsFrom(rows('questions'), named, buyersOf) } }
}

/** Questions grouped by the product they name: one topic each, in the order products came. */
function topicsFrom(
  questions: readonly HelpFillRow[],
  products: readonly { id: string; name: string; job: string }[],
  buyersOf: ReadonlyMap<string, readonly HelpFillRow[]>
): SetupPlanTopic[] {
  const groups = new Map<string, { name: string; situation: string; rows: HelpFillRow[] }>()
  for (const row of questions) {
    const written = (row.values.product ?? '').trim()
    const product =
      products.find((item) => fold(item.name) === fold(written)) ??
      (products.length === 1 && written.length === 0 ? products[0] : undefined)
    const key = product?.id ?? GENERAL
    let group = groups.get(key)
    if (group === undefined) {
      const problem = product
        ? (buyersOf.get(product.id) ?? [])
            .map((buyer) => (buyer.values.problem ?? '').trim())
            .find((text) => text.length > 0)
        : undefined
      group = {
        name: product?.name ?? GENERAL,
        situation: problem ?? product?.job ?? '',
        rows: []
      }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()].slice(0, MAX_TOPICS).map((group, index) => ({
    id: `answer-topic-${index + 1}`,
    name: group.name,
    situation: group.situation,
    questions: group.rows.slice(0, MAX_TOPIC_QUESTIONS).map((row) => {
      const stage = row.values.stage ?? ''
      return {
        id: row.id,
        text: (row.values.question ?? '').trim(),
        stage: isTopicStage(stage) ? stage : 'problem',
        keep: true
      }
    })
  }))
}

/** The ticked questions as `topics:createTopics` topics; topics left with none are skipped. */
export function topicsToCreate(plan: SetupPlan | null): CreateTopicsRequest['topics'] {
  if (plan === null) return []
  return plan.topics
    .map((topic) => ({
      name: topic.name,
      situation: topic.situation.slice(0, 500),
      questions: topic.questions
        .filter((question) => question.keep)
        .map((question) => ({ text: question.text, stage: question.stage })),
      targetUrl: null
    }))
    .filter((topic) => topic.questions.length > 0)
}

/** Ticks or unticks one question. */
export function toggleQuestion(plan: SetupPlan, id: string): SetupPlan {
  return {
    ...plan,
    topics: plan.topics.map((topic) => ({
      ...topic,
      questions: topic.questions.map((question) =>
        question.id === id ? { ...question, keep: !question.keep } : question
      )
    }))
  }
}

export function keptQuestions(plan: SetupPlan | null): number {
  return (plan?.topics ?? []).reduce(
    (sum, topic) => sum + topic.questions.filter((question) => question.keep).length,
    0
  )
}

function fold(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, ' ')
}
