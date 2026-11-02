import {
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  type BuyerPrompt,
  type PromptSetView
} from '@shared/domain'
import type {
  AddPromptRequest,
  EditPromptRequest,
  PromptSetList,
  ReorderPromptsRequest,
  SetActivePromptSetRequest,
  SetPromptEnabledRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { generateBuyerPrompts, savePromptEdits } from '../pipeline/setup'
import {
  activatePromptSet,
  getLatestBuyerProfile,
  getLatestPromptSet,
  listSavedPromptSets
} from '../storage/content-records'
import { getStoredPage, listPageMarkets } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import type { SqliteDatabase } from '../storage/database'
import type { EngineHost, PromptDraftState } from './host'
import { pageKey } from './host'
import { pageMarkets, requirePage } from './page-access'
import { linkSavedPrompts } from './prompt-reword'
import { withProject } from './project-db'
import { pageSetupDeps } from './setup-deps'

export function listPrompts(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PromptSetView> {
  return withProject(host, projectId, 'prompts:list', (opened) => {
    requirePage(opened.db, pageId, projectId, 'prompts:list')
    return currentView(host, opened.db, projectId, pageId)
  })
}

export function listPromptSets(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PromptSetList> {
  return withProject(host, projectId, 'prompts:listSets', (opened) => {
    requirePage(opened.db, pageId, projectId, 'prompts:listSets')
    return { pageId, sets: listSavedPromptSets(opened.db, pageId) }
  })
}

export function setActivePromptSet(
  host: EngineHost,
  request: SetActivePromptSetRequest
): Promise<PromptSetView> {
  const channel = 'prompts:setActive'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    const view = activatePromptSet(
      opened.db,
      request.pageId,
      request.promptSetId,
      brandNames(opened.db)
    )
    if (view === null) throw new IpcRequestError(channel, 'That prompt set was not found')
    host.memory.drafts.delete(pageKey(request.projectId, request.pageId))
    return view
  })
}

export function generatePrompts(
  host: EngineHost,
  projectId: string,
  pageId: string,
  templateId: string | undefined
): Promise<PromptSetView> {
  const channel = 'prompts:generate'
  return withProject(host, projectId, channel, async (opened) => {
    requirePage(opened.db, pageId, projectId, channel)
    const options = templateId === undefined ? { rewrite: true } : { rewrite: true, templateId }
    const view = await generateBuyerPrompts(
      pageSetupDeps(host, opened.db, projectId, channel),
      pageId,
      options
    )
    host.memory.drafts.delete(pageKey(projectId, pageId))
    return view
  })
}

export function addPrompt(host: EngineHost, request: AddPromptRequest): Promise<PromptSetView> {
  const channel = 'prompts:add'
  return withProject(host, request.projectId, channel, (opened) => {
    const draft = ensureDraft(host, opened.db, request.projectId, request.pageId, channel)
    const markets = pageMarkets(opened.db, request.pageId)
    if (markets.length === 0) {
      throw new PipelineError('Add a market before writing prompts.', {
        code: 'not_found',
        nextStep: 'Add a market on the page, then write the prompts.'
      })
    }
    draft.prompts.push({
      id: `prompt-${host.createId()}`,
      position: draft.prompts.length + 1,
      label: request.label,
      source: request.source,
      intentStage: request.intentStage,
      mappedElement: request.mappedElement,
      enabled: true,
      variants: markets.map((market) => ({
        marketId: market.id,
        language: market.language,
        text: request.text,
        originalText: null
      }))
    })
    return dirtyView(opened.db, request.pageId, draft)
  })
}

export function editPrompt(host: EngineHost, request: EditPromptRequest): Promise<PromptSetView> {
  const channel = 'prompts:edit'
  return withProject(host, request.projectId, channel, (opened) => {
    const draft = ensureDraft(host, opened.db, request.projectId, request.pageId, channel)
    const prompt = findPrompt(draft, request.promptId, channel)
    if (request.label !== undefined) prompt.label = request.label
    if (request.source !== undefined) prompt.source = request.source
    if (request.intentStage !== undefined) prompt.intentStage = request.intentStage
    if (request.mappedElement !== undefined) prompt.mappedElement = request.mappedElement
    if (request.variant !== undefined) {
      const variant = prompt.variants.find((item) => item.marketId === request.variant?.marketId)
      if (variant === undefined)
        throw new IpcRequestError(channel, 'That market is not on this prompt')
      variant.text = request.variant.text
      variant.originalText = null
    }
    return dirtyView(opened.db, request.pageId, draft)
  })
}

export function removePrompt(
  host: EngineHost,
  projectId: string,
  pageId: string,
  promptId: string
): Promise<PromptSetView> {
  const channel = 'prompts:remove'
  return withProject(host, projectId, channel, (opened) => {
    const draft = ensureDraft(host, opened.db, projectId, pageId, channel)
    const next = draft.prompts.filter((prompt) => prompt.id !== promptId)
    if (next.length === draft.prompts.length) {
      throw new IpcRequestError(channel, 'That prompt was not found')
    }
    draft.prompts = next.map((prompt, index) => ({ ...prompt, position: index + 1 }))
    return dirtyView(opened.db, pageId, draft)
  })
}

export function setEnabled(
  host: EngineHost,
  request: SetPromptEnabledRequest
): Promise<PromptSetView> {
  const channel = 'prompts:setEnabled'
  return withProject(host, request.projectId, channel, (opened) => {
    const draft = ensureDraft(host, opened.db, request.projectId, request.pageId, channel)
    const prompt = findPrompt(draft, request.promptId, channel)
    prompt.enabled = request.enabled
    return dirtyView(opened.db, request.pageId, draft)
  })
}

export function reorderPrompts(
  host: EngineHost,
  request: ReorderPromptsRequest
): Promise<PromptSetView> {
  const channel = 'prompts:reorder'
  return withProject(host, request.projectId, channel, (opened) => {
    const draft = ensureDraft(host, opened.db, request.projectId, request.pageId, channel)
    const byId = new Map(draft.prompts.map((prompt) => [prompt.id, prompt]))
    if (
      request.promptIds.length !== draft.prompts.length ||
      request.promptIds.some((id) => !byId.has(id))
    ) {
      throw new IpcRequestError(channel, 'Those prompts are not the current set')
    }
    draft.prompts = request.promptIds.map((id, index) => {
      const prompt = byId.get(id)
      if (prompt === undefined)
        throw new IpcRequestError(channel, 'Those prompts are not the current set')
      return { ...prompt, position: index + 1 }
    })
    return dirtyView(opened.db, request.pageId, draft)
  })
}

export function savePrompts(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PromptSetView> {
  const channel = 'prompts:save'
  return withProject(host, projectId, channel, (opened) => {
    requirePage(opened.db, pageId, projectId, channel)
    const key = pageKey(projectId, pageId)
    const draft = host.memory.drafts.get(key)
    if (draft === undefined) return currentView(host, opened.db, projectId, pageId)
    if (draft.prompts.length === 0) {
      throw new IpcRequestError(channel, 'A prompt set needs at least one prompt.')
    }
    if (
      draft.prompts.some((prompt) =>
        prompt.variants.some((variant) => variant.text.trim().length === 0)
      )
    ) {
      throw new IpcRequestError(channel, 'Write every prompt before saving.')
    }
    const previousIds = draft.prompts.map((prompt) => prompt.id)
    const saved = opened.db.transaction(() => {
      const now = host.now().toISOString()
      const view = savePromptEdits(opened.db, pageId, draft.prompts, {
        projectId,
        now: () => now
      })
      // "Over time" on prompt detail follows each prompt back through the versions.
      linkSavedPrompts(opened.db, pageId, previousIds, view, view.savedAt ?? now)
      return view
    })()
    host.memory.drafts.delete(key)
    return saved
  })
}

export function discardPrompts(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PromptSetView> {
  return withProject(host, projectId, 'prompts:discard', (opened) => {
    requirePage(opened.db, pageId, projectId, 'prompts:discard')
    host.memory.drafts.delete(pageKey(projectId, pageId))
    return currentView(host, opened.db, projectId, pageId)
  })
}

function currentView(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  pageId: string
): PromptSetView {
  const draft = host.memory.drafts.get(pageKey(projectId, pageId))
  if (draft !== undefined) return dirtyView(db, pageId, draft)
  const saved = getLatestPromptSet(db, pageId, brandNames(db))
  if (saved !== null) return saved
  return emptyView(db, pageId)
}

function ensureDraft(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  channel: string
): PromptDraftState {
  requirePage(db, pageId, projectId, channel)
  requireProfile(db, pageId)
  const key = pageKey(projectId, pageId)
  const existing = host.memory.drafts.get(key)
  if (existing !== undefined) return existing
  const saved = getLatestPromptSet(db, pageId, brandNames(db))
  const profile = getLatestBuyerProfile(db, pageId)
  const draft: PromptDraftState = {
    promptSetId: saved?.promptSetId ?? null,
    version: saved?.version ?? null,
    savedAt: saved?.savedAt ?? null,
    icpId: saved?.icpId ?? profile?.id ?? null,
    templateId: saved?.templateId ?? null,
    templateName: saved?.templateName ?? null,
    templateHash: saved?.templateHash ?? null,
    templateUpdatedAt: saved?.templateUpdatedAt ?? null,
    prompts: saved === null ? [] : clonePrompts(saved.prompts)
  }
  host.memory.drafts.set(key, draft)
  return draft
}

function dirtyView(db: SqliteDatabase, pageId: string, draft: PromptDraftState): PromptSetView {
  const brands = brandCopy(
    brandNames(db),
    draft.prompts.flatMap((prompt) => prompt.variants.map((variant) => variant.text))
  )
  return {
    pageId,
    promptSetId: draft.promptSetId,
    version: draft.version,
    savedAt: draft.savedAt,
    icpId: draft.icpId,
    templateId: draft.templateId,
    templateName: draft.templateName,
    templateHash: draft.templateHash,
    templateUpdatedAt: draft.templateUpdatedAt,
    dirty: true,
    nextVersion: (draft.version ?? 0) + 1,
    prompts: draft.prompts,
    brandsClear: brands.brandsClear,
    brandMessage: brands.brandMessage,
    nextCheck: estimate(db, pageId, draft.prompts)
  }
}

function emptyView(db: SqliteDatabase, pageId: string): PromptSetView {
  const brands = brandCopy(brandNames(db), [])
  return {
    pageId,
    promptSetId: null,
    version: null,
    savedAt: null,
    icpId: null,
    templateId: null,
    templateName: null,
    templateHash: null,
    templateUpdatedAt: null,
    dirty: false,
    nextVersion: null,
    prompts: [],
    brandsClear: brands.brandsClear,
    brandMessage: brands.brandMessage,
    nextCheck: estimate(db, pageId, [])
  }
}

function estimate(
  db: SqliteDatabase,
  pageId: string,
  prompts: readonly BuyerPrompt[]
): PromptSetView['nextCheck'] {
  const page = getStoredPage(db, pageId)
  const enabled = prompts.filter((prompt) => prompt.enabled).length
  const markets = listPageMarkets(db, pageId).length
  const samples = page?.samples ?? 1
  return {
    prompts: enabled,
    markets,
    samples,
    minSearches: enabled * markets * samples * SEARCHES_PER_PROMPT_MIN,
    maxSearches: enabled * markets * samples * SEARCHES_PER_PROMPT_MAX
  }
}

function brandNames(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}

function brandCopy(
  brands: readonly string[],
  texts: readonly string[]
): { brandsClear: boolean; brandMessage: string } {
  const brandsClear = texts.every((text) => {
    const haystack = text.toLowerCase()
    return brands.every((brand) => {
      const needle = brand.trim().toLowerCase()
      return needle.length === 0 || !haystack.includes(needle)
    })
  })
  const names = brands.length === 0 ? 'a brand name' : brands.join(' or ')
  return {
    brandsClear,
    brandMessage: brandsClear ? `No question contains ${names}.` : `A question contains ${names}.`
  }
}

function findPrompt(draft: PromptDraftState, promptId: string, channel: string): BuyerPrompt {
  const prompt = draft.prompts.find((item) => item.id === promptId)
  if (prompt === undefined) throw new IpcRequestError(channel, 'That prompt was not found')
  return prompt
}

function requireProfile(db: SqliteDatabase, pageId: string): void {
  if (getLatestBuyerProfile(db, pageId) === null) {
    throw new PipelineError('Write the buyer profile before the prompts.', {
      code: 'not_found',
      nextStep: 'Generate the buyer profile, then write the prompts.'
    })
  }
}

function clonePrompts(prompts: readonly BuyerPrompt[]): BuyerPrompt[] {
  return prompts.map((prompt) => ({
    ...prompt,
    variants: prompt.variants.map((variant) => ({ ...variant }))
  }))
}
