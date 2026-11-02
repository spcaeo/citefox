import type { BuyerPrompt, Market, PromptSetView } from '@shared/domain'
import { brandCheck, searchEstimate } from '../../../pageSetup/model'
import type { ProjectMemory } from '../memory'
import { ALERTS_PAGE_ID, alertsGaps, alertsProfile, alertsRead, failedRead } from '../textboltPage'
import { channelError, clone, emptyPrompts, seedPrompts } from './helpers'
import type { PageState, PromptState } from './types'

/** Shared state and lookups for every setup mock channel. One per `createSetupStore`. */
export interface SetupContext {
  memory: ProjectMemory
  nextId(prefix: string): string
  now(): string
  stateFor(pageId: string): PageState
  requirePage(request: { projectId: string; pageId: string }, channel: string): PageState
  brandsOf(projectId: string): readonly string[]
  touchPrompts(pageId: string, prompts: PromptState): void
  viewOf(projectId: string, pageId: string, prompts: PromptState): PromptSetView
  markDirty(prompts: PromptState): void
  requirePrompt(prompts: PromptState, promptId: string, channel: string): BuyerPrompt
}

export function createSetupContext(memory: ProjectMemory): SetupContext {
  const pages = new Map<string, PageState>()
  let clock = Date.parse('2026-10-19T10:30:00.000Z')
  let sequence = 1

  function nextId(prefix: string): string {
    sequence += 1
    return `${prefix}-${sequence}`
  }

  function now(): string {
    clock += 1000
    return new Date(clock).toISOString()
  }

  function stateFor(pageId: string): PageState {
    const existing = pages.get(pageId)
    if (existing) return existing
    const created: PageState = {
      read:
        pageId === ALERTS_PAGE_ID ? alertsRead() : pageId === 'bulk' ? failedRead('bulk') : null,
      profile: pageId === ALERTS_PAGE_ID ? alertsProfile() : null,
      prompts: pageId === ALERTS_PAGE_ID ? seedPrompts(marketsOf(ALERTS_PAGE_ID)) : emptyPrompts(),
      gaps: pageId === ALERTS_PAGE_ID ? alertsGaps() : null
    }
    pages.set(pageId, created)
    return created
  }

  function marketsOf(pageId: string): Market[] {
    const page = findPage(pageId)
    return page ? [...page.markets] : []
  }

  function findPage(pageId: string): ReturnType<ProjectMemory['getPage']> | null {
    for (const project of memory.list().projects) {
      try {
        return memory.getPage(project.id, pageId)
      } catch {
        continue
      }
    }
    return null
  }

  function requirePage(request: { projectId: string; pageId: string }, channel: string): PageState {
    try {
      memory.getPage(request.projectId, request.pageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That page is not in this project.'
      throw channelError(channel, message)
    }
    return stateFor(request.pageId)
  }

  function brandsOf(projectId: string): readonly string[] {
    return memory.get(projectId).brandNames
  }

  function touchPrompts(pageId: string, prompts: PromptState): void {
    const page = findPage(pageId)
    if (!page) return
    memory.noteSetup(page.projectId, pageId, {
      promptSetVersion: prompts.version,
      promptCount: Math.max(prompts.working.length, 1),
      setupStep:
        page.setupStep === 'prompts' && prompts.version !== null && !prompts.dirty
          ? 'check'
          : page.setupStep
    })
  }

  function viewOf(projectId: string, pageId: string, prompts: PromptState): PromptSetView {
    const page = memory.getPage(projectId, pageId)
    const enabled = prompts.working.filter((prompt) => prompt.enabled).length
    const texts = prompts.working.flatMap((prompt) =>
      prompt.variants.map((variant) => variant.text)
    )
    const checked = brandCheck(texts, brandsOf(projectId))
    const brandMessage =
      prompts.brandMessage && checked.brandsClear ? prompts.brandMessage : checked.brandMessage
    return {
      pageId,
      promptSetId: prompts.promptSetId,
      version: prompts.version,
      savedAt: prompts.savedAt,
      icpId: stateFor(pageId).profile?.id ?? null,
      templateId: prompts.templateId,
      templateName: prompts.templateName,
      templateHash: prompts.templateHash,
      templateUpdatedAt: prompts.templateUpdatedAt,
      dirty: prompts.dirty,
      nextVersion: prompts.dirty ? (prompts.version ?? 0) + 1 : null,
      prompts: clone(prompts.working),
      brandsClear: checked.brandsClear,
      brandMessage,
      nextCheck: searchEstimate(enabled, page.markets.length, page.samples)
    }
  }

  function markDirty(prompts: PromptState): void {
    prompts.dirty = true
    prompts.brandMessage = null
  }

  function requirePrompt(prompts: PromptState, promptId: string, channel: string): BuyerPrompt {
    const prompt = prompts.working.find((item) => item.id === promptId)
    if (!prompt) throw channelError(channel, 'That prompt is not in this set.')
    return prompt
  }

  return {
    memory,
    nextId,
    now,
    stateFor,
    requirePage,
    brandsOf,
    touchPrompts,
    viewOf,
    markDirty,
    requirePrompt
  }
}
