import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { ANSWER_SHAPE_SCHEMA } from '../../analytics/answer-shape/schema'
import { contentHash, wordCount } from '../../pipeline/hash'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import type { StoredSnapshot } from '../../storage/content-records'

/** Fixture page, snapshot, prompts, and a scripted Claude for the check report tests. */
export const FIXTURES = join(process.cwd(), 'src/main/engine/checks/fixtures')
export const EXPECTED = join(FIXTURES, 'expected')
export const SERP = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
export const NOW = '2026-10-19T12:00:00.000Z'
export const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
export const BODY =
  'TextBolt turns email from tools you already use into SMS for a crew. It does not say that carrier gateways shut down.'
export const PLANTED = 'sk-ant-api03-abcdefghij'
export const PLANTED_EXACT = 'citefox-planted-secret'
export const SECRET = 'sk-test-secret-value'
export const MARKETS = [
  { id: 'mkt-us', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-mx', country: 'MX', language: 'es', device: 'mobile' as const },
  { id: 'mkt-cited', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-noaio', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-gap', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-secret', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-cancelled', country: 'US', language: 'en', device: 'desktop' as const },
  { id: 'mkt-error', country: 'US', language: 'en', device: 'desktop' as const }
]

export function provider(gapName: string, seen: string[] = []): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request) {
      seen.push(request.prompt)
      const name = request.prompt.startsWith('Template: aio_gap.md') ? gapName : 'run-summary.json'
      const json =
        request.schema === ANSWER_SHAPE_SCHEMA
          ? answerShapeReply(request.prompt)
          : (JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 3,
        outputTokens: 2,
        durationMs: 1,
        model: 'fixture',
        resolvedModel: 'fixture',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

/** One `D1` block whose excerpt is the opening words of the overview in the prompt. */
export function answerShapeReply(prompt: string): unknown {
  const overview = /The AI Overview text:\n([\s\S]*?)\n\nSplit the overview/.exec(prompt)?.[1] ?? ''
  return { blocks: [{ code: 'D1', excerpt: overview.slice(0, 40).trim() || 'missing' }] }
}

export function read(file: string): string {
  return readFileSync(file, 'utf8')
}

export function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: PAGE_URL,
    title: 'Alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 5,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

export function snapshot(): StoredSnapshot {
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: NOW,
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'Email to SMS',
    h1: 'Text alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 1,
    h3Count: 0,
    tableCount: 0,
    bodyText: BODY,
    wordCount: wordCount(BODY),
    contentHash: contentHash(BODY),
    summary: null
  }
}

export function buyer(): BuyerProfile {
  return {
    id: 'icp-1',
    pageId: 'page-1',
    snapshotId: 'snap-1',
    who: 'Office managers.',
    environment: 'They send email.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: NOW,
    promptsStale: false
  }
}

export function prompt(
  id: string,
  position: number,
  label: string,
  text: string,
  markets: 'all' | 'split' | 'mkt-us',
  language: string
): BuyerPrompt {
  const variants =
    markets === 'mkt-us'
      ? [{ marketId: 'mkt-us', language, text, originalText: null }]
      : MARKETS.map((market) => ({
          marketId: market.id,
          language: market.language,
          text:
            markets === 'split' && market.id === 'mkt-mx'
              ? 'Como aviso al equipo si el operador corta los SMS?'
              : text,
          originalText: null
        }))
  return {
    id,
    position,
    label,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants
  }
}
