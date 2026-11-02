import type { BuyerPrompt, PromptVariant } from '@shared/domain'
import type {
  MergePagesRequest,
  MergePagesResult,
  PointPromptRequest,
  PointPromptResult,
  PointPromptUndo,
  UndoPointRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { createFixFollowUp, listFixFollowUps } from '../../storage/fix-follow-ups'
import { getPage, listPageMarkets } from '../../storage/pages'
import { readProjectProfile, listMarkets } from '../../storage/project-profile'
import {
  activatePromptSet,
  getLatestPromptSet,
  insertPromptSet,
  nextPromptSetVersion
} from '../../storage/prompt-set-records'
import { pageKey, type EngineHost } from '../host'
import type { AllPagesPass } from './pass'

/**
 * FR-20.4 "Point it here". The prompt leaves the tracked page's active set and
 * joins the cited page's active set, as a new saved version on each page. The
 * next check of each page uses its new set; past results keep their version.
 * Undo makes the two previous sets active again.
 */
export function pointPromptHere(
  host: EngineHost,
  pass: AllPagesPass,
  request: PointPromptRequest
): PointPromptResult {
  const channel = 'allpages:pointHere'
  const { db, project } = pass
  const from = getPage(db, request.fromPageId, project.id)
  const to = getPage(db, request.toPageId, project.id)
  if (from === null || to === null) throw new IpcRequestError(channel, 'That page was not found')
  if (from.id === to.id) throw new IpcRequestError(channel, 'Choose another page')
  const toLabel = to.label ?? to.title ?? to.url
  for (const page of [from, to]) {
    if (host.memory.drafts.has(pageKey(project.id, page.id))) {
      return {
        ok: false,
        message: `${page.label ?? page.title ?? page.url} has prompt edits that are not saved.`,
        nextStep: 'Save or discard those edits on its Prompts tab, then point the prompt again.'
      }
    }
  }
  const brands = readProjectProfile(db)?.brandNames ?? []
  const fromSet = getLatestPromptSet(db, from.id, brands)
  const toSet = getLatestPromptSet(db, to.id, brands)
  const prompt = fromSet?.prompts.find((item) => item.id === request.promptId)
  if (fromSet === null || fromSet.promptSetId === null || fromSet.icpId === null || !prompt) {
    throw new IpcRequestError(channel, 'That prompt is no longer on the page')
  }
  if (toSet === null || toSet.promptSetId === null || toSet.icpId === null) {
    return {
      ok: false,
      message: `${toLabel} has no saved prompts yet, so the prompt cannot move there.`,
      nextStep: `Track ${toLabel} and finish its setup (read, buyer profile, prompts), then point the prompt here.`
    }
  }
  const remaining = fromSet.prompts.filter((item) => item.id !== prompt.id)
  if (remaining.length === 0) {
    return {
      ok: false,
      message: 'This is the only prompt on the tracked page. A page keeps at least one prompt.',
      nextStep: 'Add another prompt to the tracked page first, or use Merge.'
    }
  }
  const at = pass.now.toISOString()
  const marketIds = new Set(listPageMarkets(db, to.id).map((link) => link.marketId))
  const moved: BuyerPrompt = {
    ...prompt,
    id: `prompt-${host.createId()}`,
    position: Math.max(0, ...toSet.prompts.map((item) => item.position)) + 1,
    variants: variantsFor(prompt.variants, marketIds, listMarkets(db))
  }
  const undo: PointPromptUndo = {
    fromPageId: from.id,
    toPageId: to.id,
    fromPromptSetId: fromSet.promptSetId,
    toPromptSetId: toSet.promptSetId
  }
  db.transaction(() => {
    insertPromptSet(
      db,
      {
        id: `pset-${host.createId()}`,
        pageId: from.id,
        version: nextPromptSetVersion(db, from.id),
        savedAt: at,
        icpId: fromSet.icpId ?? '',
        templateId: fromSet.templateId,
        templateName: fromSet.templateName,
        templateHash: fromSet.templateHash,
        templateUpdatedAt: fromSet.templateUpdatedAt,
        prompts: remaining.map((item, index) => ({
          ...item,
          id: `prompt-${host.createId()}`,
          position: index + 1
        }))
      },
      brands
    )
    insertPromptSet(
      db,
      {
        id: `pset-${host.createId()}`,
        pageId: to.id,
        version: nextPromptSetVersion(db, to.id),
        savedAt: at,
        icpId: toSet.icpId ?? '',
        templateId: toSet.templateId,
        templateName: toSet.templateName,
        templateHash: toSet.templateHash,
        templateUpdatedAt: toSet.templateUpdatedAt,
        prompts: [
          ...toSet.prompts.map((item) => ({ ...item, id: `prompt-${host.createId()}` })),
          moved
        ]
      },
      brands
    )
  })()
  return {
    ok: true,
    message: `“${prompt.label}” now belongs to ${toLabel} from its next check.`,
    undo
  }
}

export function undoPointPrompt(pass: AllPagesPass, request: UndoPointRequest): PointPromptUndo {
  const channel = 'allpages:undoPoint'
  const brands = readProjectProfile(pass.db)?.brandNames ?? []
  pass.db.transaction(() => {
    const from = activatePromptSet(pass.db, request.fromPageId, request.fromPromptSetId, brands)
    const to = activatePromptSet(pass.db, request.toPageId, request.toPromptSetId, brands)
    if (from === null || to === null) {
      throw new IpcRequestError(channel, 'Those prompt sets were not found')
    }
  })()
  return {
    fromPageId: request.fromPageId,
    toPageId: request.toPageId,
    fromPromptSetId: request.fromPromptSetId,
    toPromptSetId: request.toPromptSetId
  }
}

/**
 * FR-20.4 "Merge". Adds a fix to the tracked page's Progress list: combine the
 * two pages and redirect one to the other. Its follow-up is the page's next
 * scheduled check, so it costs no extra searches.
 */
export function mergePages(
  host: EngineHost,
  pass: AllPagesPass,
  request: MergePagesRequest
): MergePagesResult {
  const channel = 'allpages:merge'
  const page = getPage(pass.db, request.pageId, pass.project.id)
  if (page === null) throw new IpcRequestError(channel, 'That page was not found')
  const fix = createFixFollowUp(pass.db, {
    id: `fix-${host.createId()}`,
    pageId: page.id,
    description:
      `Merge ${request.citedUrl} into ${page.url} and redirect one to the other. Google cites ${request.citedUrl} instead for one of this page's prompts.`.slice(
        0,
        4000
      ),
    goLiveAt: pass.now.toISOString(),
    rule: 'next_scheduled',
    promptIds: [request.promptId],
    marketIds: [request.marketId]
  })
  return {
    fixId: fix.id,
    fixNumber: fix.number,
    message: `Fix #${fix.number} added to ${page.label ?? page.title ?? page.url}'s Progress: combine the two pages and redirect one. Its follow-up is the next scheduled check.`
  }
}

export function undoMerge(pass: AllPagesPass, fixId: string): { fixId: string } {
  const channel = 'allpages:undoMerge'
  const fix = listFixFollowUps(pass.db).find((item) => item.id === fixId)
  if (fix === undefined || fix.followUpRunId !== null) {
    throw new IpcRequestError(channel, 'That fix was not found or has already been checked')
  }
  pass.db.prepare(`DELETE FROM fixes WHERE id = ?`).run(fixId)
  return { fixId }
}

/** The moved prompt keeps each wording it has for the target page's markets. */
function variantsFor(
  variants: readonly PromptVariant[],
  marketIds: ReadonlySet<string>,
  markets: readonly { id: string; language: string }[]
): PromptVariant[] {
  const kept = variants.filter((variant) => marketIds.has(variant.marketId))
  const fallback = variants[0]
  if (fallback === undefined) return kept
  for (const marketId of marketIds) {
    if (kept.some((variant) => variant.marketId === marketId)) continue
    const language = markets.find((market) => market.id === marketId)?.language ?? fallback.language
    const sameLanguage = variants.find((variant) => variant.language === language) ?? fallback
    kept.push({ ...sameLanguage, marketId, language })
  }
  return kept.length > 0 ? kept : [...variants]
}
