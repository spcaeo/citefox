import type { TopicResultRow } from '@shared/domain'
import type { DraftPageEditRequest, PageBlock, PageEditChange, PageEditResult } from '@shared/ipc'
import { fence } from '../prompts/blocks'
import { brandInQuestion, causeProblem } from '../prompts/citations'
import type { SqliteDatabase } from '../storage/database'
import { putPageEdit } from '../storage/page-edits'
import { readProjectProfile } from '../storage/project-profile'
import { readTrackedPageNow } from '../engine/page-read'
import { getPage } from '../storage/pages'
import { getLatestSnapshot } from '../storage/snapshot-records'
import { runTopicTemplate } from './claude'
import { TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { overviewForPrompt, topicMarketBlock } from './insight-context'
import { blocksForPrompt, blocksFromMarkdown, blocksFromText } from './page-blocks'
import { getSiteRead, OLD_SITE_READ_TEXT_MAX } from './records'
import { loadTopicResults } from './results'
import { readOne } from './site'

/**
 * Page edits (What to fix › Page edits): the page as blocks (its snapshot when
 * tracked, else a site read, read live when there is none), then one
 * `topic_page_edit` call for the changes: blocks to cut, rewrite or add. Code checks
 * every block id, keeps the H1, and saves the result per fix. Never a search.
 */

export const PAGE_NOT_READ =
  "Couldn't read this page. Check it opens in your browser, then try again."

/** Most changes kept from one reply. */
export const PAGE_EDIT_MAX_CHANGES = 14

type PageEditReply = {
  summary: string
  changes: {
    op: 'delete' | 'replace' | 'insert'
    block: string | null
    kind: PageBlock['kind']
    text: string | null
    why: string
  }[]
}

interface PageForEdit {
  title: string | null
  readAt: string
  blocks: PageBlock[]
}

/** The page as blocks: the tracked page's snapshot, else a saved site read, else a live read. */
export async function pageForEdit(
  env: TopicEnv,
  db: SqliteDatabase,
  target: { pageId: string | null; url: string; projectId?: string }
): Promise<PageForEdit> {
  if (target.pageId !== null) {
    let snapshot = getLatestSnapshot(db, target.pageId)
    // A tracked page never read: read it the tracked way, so it starts its history.
    if (snapshot === null && target.projectId !== undefined) {
      const page = getPage(db, target.pageId, target.projectId)
      if (page?.url) {
        await readTrackedPageNow(env.host, db, target.projectId, target.pageId)
        snapshot = getLatestSnapshot(db, target.pageId)
      }
    }
    if (snapshot !== null) {
      const blocks = blocksFromText(snapshot.bodyText, snapshot.outline, snapshot.h1)
      if (blocks.length > 0) {
        return { title: titleOf(snapshot.title), readAt: snapshot.fetchedAt, blocks }
      }
    }
  }
  const cached = getSiteRead(db, target.url)
  // A read saved under the old 20,000-character cap may stop mid-page: read it again.
  const cut = cached?.ok === true && cached.text.length >= OLD_SITE_READ_TEXT_MAX
  const read =
    cached?.ok === true && !cut
      ? cached
      : await readOne(env.host, db, target.url, cached?.role ?? 'other', cached !== null)
  const blocks = read.ok ? blocksFromMarkdown(read.text) : []
  if (blocks.length === 0) throw new TopicInputError(PAGE_NOT_READ)
  return { title: titleOf(read.title) ?? titleOf(read.h1), readAt: read.readAt, blocks }
}

/** What the overview says for the best search, and who it cites, from the saved checks. */
export function overviewForEdit(
  opened: OpenedProject,
  request: Pick<DraftPageEditRequest, 'topicId' | 'searches'>,
  builtAt: string
): { aioText: string; citedNow: string; marketId: string | null } {
  const none = {
    aioText: 'No AI Overview was stored for these searches.',
    citedNow: 'None stored.',
    marketId: null
  }
  const best = request.searches[0]
  if (request.topicId === null || best === undefined) return none
  let row: TopicResultRow | undefined
  let marketId: string | null
  try {
    const results = loadTopicResults(opened.db, {
      projectId: opened.project.id,
      topicId: request.topicId,
      marketId: null,
      runId: null,
      domain: opened.project.domain,
      builtAt,
      engine: null
    })
    marketId = results.topic.marketId
    const wanted = squash(best)
    row = results.rows.find((item) => squash(item.text) === wanted)
  } catch {
    return none
  }
  if (row === undefined || row.runId === null || row.state === 'no_aio') {
    return { ...none, marketId }
  }
  const overview = overviewForPrompt(opened.db, {
    promptId: row.promptId,
    runId: row.runId,
    topicId: request.topicId,
    ownDomain: opened.project.domain
  })
  return { aioText: overview.overview, citedNow: overview.sources, marketId }
}

/**
 * The reply's problem in plain words, for one retry: block ids that are not on the
 * page, a missing text, a deleted H1, a brand inside a buyer question, a line that
 * credits a change with a citation. Null when it is fine.
 */
export function pageEditProblem(
  reply: PageEditReply,
  blocks: readonly PageBlock[],
  brands: readonly string[]
): string | null {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  for (const change of reply.changes) {
    if (change.op === 'insert') {
      if (change.block !== null && !byId.has(change.block)) {
        return `Change "${change.why}" goes after ${change.block}, which is not a block of the page. Use an id from the list, or null for the top.`
      }
    } else if (change.block === null || !byId.has(change.block)) {
      return `Every ${change.op} names a block id from the list; ${change.block ?? 'null'} is not one.`
    }
    if (change.op !== 'delete' && (change.text === null || change.text.trim().length === 0)) {
      return `Every ${change.op} needs its text.`
    }
    if (change.op === 'delete' && change.block !== null && byId.get(change.block)?.kind === 'h1') {
      return 'Never delete the H1. Rewrite it with a replace when it must change.'
    }
  }
  const touched = reply.changes
    .filter((change) => change.op !== 'insert')
    .map((change) => change.block)
  if (new Set(touched).size !== touched.length) {
    return 'Change each existing block at most once.'
  }
  const questions = reply.changes
    .filter((change) => change.op !== 'delete' && /^h[2-4]$/.test(change.kind))
    .map((change) => change.text ?? '')
    .filter((text) => text.trim().endsWith('?'))
  return (
    brandInQuestion(questions, brands) ??
    causeProblem([
      reply.summary,
      ...reply.changes.map((change) => `${change.text ?? ''} ${change.why}`)
    ])
  )
}

/** The checked reply as the contract's changes, `c1`, `c2`, … in reply order. */
export function toChanges(reply: PageEditReply): PageEditChange[] {
  return reply.changes
    .slice(0, PAGE_EDIT_MAX_CHANGES)
    .flatMap((change, index): PageEditChange[] => {
      const id = `c${index + 1}`
      const why = change.why.trim()
      if (change.op === 'delete') {
        return change.block === null ? [] : [{ id, op: 'delete', block: change.block, why }]
      }
      const text = (change.text ?? '').trim()
      if (text.length === 0) return []
      if (change.op === 'replace') {
        return change.block === null
          ? []
          : [{ id, op: 'replace', block: change.block, kind: change.kind, text, why }]
      }
      return [{ id, op: 'insert', after: change.block, kind: change.kind, text, why }]
    })
}

/** `fixes:draftPageEdit`: reads the page, asks for its edits, saves and returns them. */
export async function draftPageEdit(
  env: TopicEnv,
  opened: OpenedProject,
  request: DraftPageEditRequest
): Promise<PageEditResult> {
  const { db } = opened
  const started = Date.now()
  const page = await pageForEdit(env, db, {
    pageId: request.pageId,
    url: request.url,
    projectId: opened.project.id
  })
  const overview = overviewForEdit(opened, request, env.host.now().toISOString())
  const brands = readProjectProfile(db)?.brandNames ?? []
  const reply = await runTopicTemplate<PageEditReply>({
    host: env.host,
    db,
    projectId: opened.project.id,
    pageId: request.pageId,
    kind: 'topic_page_edit',
    channel: 'fixes:draftPageEdit',
    context: {
      page: request.url,
      page_title: page.title ?? 'none',
      blocks: fence('page_text', blocksForPrompt(page.blocks)),
      searches:
        request.searches.length === 0
          ? 'None saved yet; edit for the page title.'
          : request.searches.map((text, index) => `${index + 1}. ${text}`).join('\n'),
      aio_text: overview.aioText,
      cited_now: overview.citedNow,
      extra_context: request.context ?? 'None.',
      market_block: topicMarketBlock(db, overview.marketId),
      ...brandVars(brands)
    },
    check: (value) => pageEditProblem(value, page.blocks, brands)
  })
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
  return putPageEdit(db, {
    fixId: request.fixId,
    url: request.url,
    title: page.title,
    readAt: page.readAt,
    blocks: page.blocks,
    changes: toChanges(reply.value),
    summary: reply.value.summary.trim(),
    note: `CiteFox AI · about ${seconds} s · no searches`,
    savedAt: env.host.now().toISOString()
  })
}

function titleOf(value: string | null): string | null {
  const title = value?.replace(/\s+/g, ' ').trim().slice(0, 600) ?? ''
  return title.length > 0 ? title : null
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}
