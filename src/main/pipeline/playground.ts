import {
  PLAYGROUND_MEMORY_RUNS,
  type GenerationTemplateKind,
  type OutlineEntry,
  type PageFaq
} from '@shared/domain'
import type {
  ModelUsage,
  PlaygroundAioResult,
  PlaygroundRunRequest,
  PlaygroundRunResult
} from '@shared/ipc'
import { CITEFOX_USER_AGENT, requestWithRetry, type HttpTransport } from '../providers/http'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import { businessBlock, competitorBlock, marketBlock, productBlock } from '../prompts/blocks'
import type { SqliteDatabase } from '../storage/database'
import {
  assertPublicPageUrl,
  MAX_DIRECT_REDIRECTS,
  systemAddressLookup,
  type AddressLookup
} from './fetch-guard'
import { extractHtml } from './extract'
import { pageAnchors, type PageAnchor } from './page-anchors'
import { PipelineError } from './errors'
import { capPageText, formatFaqs, formatLastModified, formatOutline } from './template-context'
import {
  renderTemplate,
  selectPlaygroundTemplates,
  templateHash,
  TemplateContractError
} from './templates'

const FETCH_TIMEOUT_MS = 20_000

export interface PlaygroundPage {
  url: string
  title: string
  metaDescription: string
  h1: string
  pageText: string
  /** Omitted when the reader did not extract headings, FAQs, or dates. */
  outline?: readonly OutlineEntry[]
  faqs?: readonly PageFaq[]
  modifiedAt?: string | null
  publishedAt?: string | null
  /** Absolute http(s) links on the page, so a suggested domain can be checked against them. */
  links?: readonly string[]
  /** The same links with their visible words, so the site read can see the menu. */
  anchors?: readonly PageAnchor[]
}

export interface PlaygroundModelReply {
  text: string
  resolvedModel: string
  usage: ModelUsage
  durationMs: number
}

/** One ephemeral run plus the page and any AI Overview check attached to it. */
export interface RememberedPlaygroundRun {
  result: PlaygroundRunResult
  kind: GenerationTemplateKind
  page: PlaygroundPage
  aio: PlaygroundAioResult | null
}

/** In-memory playground runs. A compare stores one entry per template. The cap is 20. */
export class PlaygroundMemory {
  private readonly runs: RememberedPlaygroundRun[] = []

  constructor(private readonly limit = PLAYGROUND_MEMORY_RUNS) {}

  remember(
    run: PlaygroundRunResult,
    details?: { kind: GenerationTemplateKind; page: PlaygroundPage }
  ): void {
    this.runs.push({
      result: run,
      kind: details?.kind ?? 'buyer_profile',
      page: details?.page ?? {
        url: run.url,
        title: '',
        metaDescription: '',
        h1: '',
        pageText: run.renderedPrompt
      },
      aio: null
    })
    if (this.runs.length > this.limit) this.runs.splice(0, this.runs.length - this.limit)
  }

  recent(): readonly PlaygroundRunResult[] {
    return this.runs.map((run) => run.result)
  }

  find(runId: string): RememberedPlaygroundRun | null {
    return this.runs.find((run) => run.result.runId === runId) ?? null
  }
}

export async function runPlayground(options: {
  db: SqliteDatabase
  request: PlaygroundRunRequest
  readPage: (url: string) => Promise<PlaygroundPage>
  complete: (
    prompt: string,
    template: { kind: GenerationTemplateKind; id: string; hash: string }
  ) => Promise<PlaygroundModelReply>
  promptCount: number
  createId: () => string
  memory: PlaygroundMemory
}): Promise<PlaygroundRunResult[]> {
  const templates = selectPlaygroundTemplates(options.db, options.request)
  // Answer shape classifies stored overviews after a check, not a live page.
  if (templates.some((template) => template.kind === 'answer_shape')) {
    throw new TemplateContractError('playground:run', 'playground_kind')
  }
  const bodies = templates.map((template) => ({
    template,
    body: options.request.overrides?.body ?? template.body
  }))
  for (const item of bodies) assertPlaygroundSyntax(item.body)
  const page = await options.readPage(options.request.url)
  const promptCount = options.request.overrides?.promptCount ?? options.promptCount
  const brandName = options.request.overrides?.brandName ?? ''
  const results: PlaygroundRunResult[] = []
  for (const item of bodies) {
    const rendered = renderTemplate(
      item.body,
      {
        url: page.url,
        title: page.title,
        meta_description: page.metaDescription,
        h1: page.h1,
        page_text: capPageText(page.pageText),
        brand_name: brandName,
        prompt_count: promptCount,
        outline: formatOutline(page.outline ?? []),
        faqs: formatFaqs(page.faqs ?? []),
        last_modified: formatLastModified(page.modifiedAt ?? null, page.publishedAt ?? null),
        ...playgroundBlocks(page.url, brandName)
      },
      item.template.kind
    )
    const reply = await options.complete(rendered.text, {
      kind: item.template.kind,
      id: item.template.id,
      hash: templateHash(item.body)
    })
    const result: PlaygroundRunResult = {
      runId: options.createId(),
      url: page.url,
      templateId: item.template.id,
      templateName: item.template.name,
      templateHash: templateHash(item.body),
      templateUpdatedAt: item.template.updatedAt,
      renderedPrompt: rendered.text,
      modelOutput: reply.text,
      resolvedModel: reply.resolvedModel,
      usage: reply.usage,
      durationMs: reply.durationMs,
      warnings: rendered.warnings
    }
    options.memory.remember(result, { kind: item.template.kind, page })
    results.push(result)
  }
  return results
}

/**
 * The context blocks the page steps read (Docs/PROMPT-AUDIT.md, P1), for a page
 * outside any project: the URL's host and the brand override, no product, no
 * market and no competitors.
 */
function playgroundBlocks(url: string, brandName: string): Record<string, string> {
  const host = hostOf(url)
  const brands = brandName
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  return {
    business_block: businessBlock({ domain: host, summary: null, brandNames: brands }),
    product_block: productBlock(null),
    market_block: marketBlock({ country: '', language: 'en' }),
    competitor_block: competitorBlock({
      product: null,
      direct: [],
      partial: [],
      switchingFrom: [],
      integrations: []
    })
  }
}

/** The URL's host without `www.`, or empty when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return ''
  }
}

function assertPlaygroundSyntax(body: string): void {
  try {
    renderTemplate(body, {
      url: '',
      title: '',
      meta_description: '',
      h1: '',
      page_text: '',
      brand_name: '',
      prompt_count: 0
    })
  } catch (error) {
    if (error instanceof PipelineError && error.code === 'template') {
      throw new TemplateContractError('playground:run', 'syntax')
    }
    throw error
  }
}

/**
 * Direct fetch of a playground URL. The host must be public.
 * The error text does not include the URL or the response body.
 */
export async function fetchPlaygroundPage(options: {
  url: string
  transport: HttpTransport
  logger: Logger
  dns?: AddressLookup
  secrets?: readonly string[]
}): Promise<PlaygroundPage> {
  const resolve = options.dns ?? systemAddressLookup()
  const secrets = options.secrets ?? []
  let current = options.url
  for (let hop = 0; ; hop += 1) {
    await assertPublicPageUrl(current, resolve)
    let response: { status: number; body: string; headers?: Readonly<Record<string, string>> }
    try {
      response = await requestWithRetry(
        options.transport,
        {
          method: 'GET',
          url: current,
          headers: {
            accept: 'text/html',
            'user-agent': CITEFOX_USER_AGENT,
            'cache-control': 'no-cache',
            pragma: 'no-cache'
          }
        },
        { timeoutMs: FETCH_TIMEOUT_MS, label: 'Playground fetch', secrets }
      )
    } catch (error) {
      options.logger.warn('playground page fetch failed', {
        message: redactString(error instanceof Error ? error.message : 'fetch failed', { secrets })
      })
      throw new PipelineError('The page could not be read.', {
        code: 'fetch_failed',
        nextStep: 'Check the URL and try again.'
      })
    }
    if (isRedirect(response.status)) {
      if (hop >= MAX_DIRECT_REDIRECTS) {
        throw new PipelineError('The page could not be read.', {
          code: 'fetch_failed',
          nextStep: 'Use a URL that does not redirect, and try again.'
        })
      }
      const location = headerValue(response.headers, 'location')
      if (location === null) {
        throw new PipelineError('The page could not be read.', {
          code: 'fetch_failed',
          nextStep: 'Use a URL that does not redirect, and try again.'
        })
      }
      try {
        current = new URL(location, current).href
      } catch {
        throw new PipelineError('The page could not be read.', {
          code: 'fetch_failed',
          nextStep: 'Use a URL that does not redirect, and try again.'
        })
      }
      continue
    }
    if (response.status < 200 || response.status >= 300 || response.body.trim().length === 0) {
      throw new PipelineError('The page could not be read.', {
        code: 'fetch_failed',
        nextStep: 'Check the URL and try again.'
      })
    }
    const extracted = extractHtml(response.body)
    return {
      url: options.url,
      title: extracted.title ?? '',
      metaDescription: extracted.metaDescription ?? '',
      h1: extracted.h1 ?? '',
      pageText: extracted.bodyText,
      outline: extracted.outline,
      faqs: extracted.faqs,
      modifiedAt: extracted.modifiedAt,
      publishedAt: extracted.publishedAt,
      links: pageLinks(response.body, current),
      anchors: pageAnchors(response.body, current)
    }
  }
}

const MAX_PAGE_LINKS = 400

/** `href` targets on the page as absolute http(s) URLs, at most `MAX_PAGE_LINKS`. */
export function pageLinks(html: string, base: string): string[] {
  const links = new Set<string>()
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"'#\s][^"'\s]*)["']/giu)) {
    if (links.size >= MAX_PAGE_LINKS) break
    try {
      const url = new URL(match[1] ?? '', base)
      if (url.protocol === 'https:' || url.protocol === 'http:') links.add(url.href)
    } catch {
      // Not a URL.
    }
  }
  return [...links]
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | null {
  if (headers === undefined) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}
