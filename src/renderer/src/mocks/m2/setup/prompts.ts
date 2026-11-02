import type { BuyerPrompt } from '@shared/domain'
import { applyTemplateChoice } from '../templates'
import { ALERTS_BRAND_MESSAGE, ALERTS_PAGE_ID } from '../textboltPage'
import type { SetupContext } from './context'
import { channelError, clone, generatedPrompts, variantsFor } from './helpers'
import type { SetupStore } from './types'

/** `prompts:*` channels. */
export function createPromptMethods(
  ctx: SetupContext
): Pick<
  SetupStore,
  | 'listPrompts'
  | 'generatePrompts'
  | 'addPrompt'
  | 'editPrompt'
  | 'removePrompt'
  | 'setPromptEnabled'
  | 'reorderPrompts'
  | 'savePrompts'
  | 'discardPrompts'
> {
  const { memory, nextId, now, requirePage, touchPrompts, viewOf, markDirty, requirePrompt } = ctx
  return {
    listPrompts(request) {
      const state = requirePage(request, 'prompts:list')
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    async generatePrompts(request) {
      const state = requirePage(request, 'prompts:generate')
      if (!state.read || state.read.nextStep !== null) {
        throw channelError('prompts:generate', 'Read the page before writing prompts.')
      }
      const page = memory.getPage(request.projectId, request.pageId)
      const count = page.promptCount
      const markets = page.markets
      const prompts = generatedPrompts(count, markets)
      const chosen = await applyTemplateChoice(
        'buyer_prompts',
        request.templateId,
        'prompts:generate',
        request.projectId,
        request.pageId,
        'promptSets'
      )
      state.prompts = {
        promptSetId: state.prompts.promptSetId ?? nextId('set'),
        version: (state.prompts.version ?? 0) + 1,
        savedAt: now(),
        templateId: chosen.templateId,
        templateName: chosen.templateName,
        templateHash: chosen.templateHash,
        templateUpdatedAt: chosen.templateUpdatedAt,
        dirty: false,
        saved: clone(prompts),
        working: prompts,
        brandMessage: request.pageId === ALERTS_PAGE_ID ? ALERTS_BRAND_MESSAGE : null
      }
      touchPrompts(request.pageId, state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    addPrompt(request) {
      const state = requirePage(request, 'prompts:add')
      const page = memory.getPage(request.projectId, request.pageId)
      const prompt: BuyerPrompt = {
        id: nextId('prompt'),
        position: state.prompts.working.length + 1,
        label: request.label,
        source: request.source,
        intentStage: request.intentStage,
        mappedElement: request.mappedElement,
        enabled: true,
        variants: variantsFor(page.markets, request.text)
      }
      state.prompts.working = [...state.prompts.working, prompt]
      markDirty(state.prompts)
      touchPrompts(request.pageId, state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    editPrompt(request) {
      const state = requirePage(request, 'prompts:edit')
      const prompt = requirePrompt(state.prompts, request.promptId, 'prompts:edit')
      if (request.label !== undefined) prompt.label = request.label
      if (request.source !== undefined) prompt.source = request.source
      if (request.intentStage !== undefined) prompt.intentStage = request.intentStage
      if (request.mappedElement !== undefined) prompt.mappedElement = request.mappedElement
      if (request.variant) {
        const variant = prompt.variants.find((item) => item.marketId === request.variant?.marketId)
        if (!variant) throw channelError('prompts:edit', 'That market is not on this prompt.')
        variant.text = request.variant.text
        variant.originalText = null
      }
      markDirty(state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    removePrompt(request) {
      const state = requirePage(request, 'prompts:remove')
      requirePrompt(state.prompts, request.promptId, 'prompts:remove')
      state.prompts.working = state.prompts.working
        .filter((prompt) => prompt.id !== request.promptId)
        .map((prompt, index) => ({ ...prompt, position: index + 1 }))
      markDirty(state.prompts)
      touchPrompts(request.pageId, state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    setPromptEnabled(request) {
      const state = requirePage(request, 'prompts:setEnabled')
      const prompt = requirePrompt(state.prompts, request.promptId, 'prompts:setEnabled')
      prompt.enabled = request.enabled
      markDirty(state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    reorderPrompts(request) {
      const state = requirePage(request, 'prompts:reorder')
      const byId = new Map(state.prompts.working.map((prompt) => [prompt.id, prompt]))
      if (request.promptIds.length !== byId.size || request.promptIds.some((id) => !byId.has(id))) {
        throw channelError('prompts:reorder', 'List every prompt in the set, once.')
      }
      state.prompts.working = request.promptIds.map((id, index) => {
        const prompt = byId.get(id)
        if (!prompt) throw channelError('prompts:reorder', 'That prompt is not in this set.')
        return { ...prompt, position: index + 1 }
      })
      markDirty(state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    savePrompts(request) {
      const state = requirePage(request, 'prompts:save')
      if (!state.prompts.dirty) return viewOf(request.projectId, request.pageId, state.prompts)
      state.prompts.version = (state.prompts.version ?? 0) + 1
      state.prompts.savedAt = now()
      state.prompts.saved = clone(state.prompts.working)
      state.prompts.dirty = false
      state.prompts.promptSetId = state.prompts.promptSetId ?? nextId('set')
      if (state.profile) state.profile = { ...state.profile, promptsStale: false }
      touchPrompts(request.pageId, state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    },

    discardPrompts(request) {
      const state = requirePage(request, 'prompts:discard')
      state.prompts.working = clone(state.prompts.saved)
      state.prompts.dirty = false
      state.prompts.brandMessage =
        request.pageId === ALERTS_PAGE_ID && state.prompts.version === 2
          ? ALERTS_BRAND_MESSAGE
          : null
      touchPrompts(request.pageId, state.prompts)
      return viewOf(request.projectId, request.pageId, state.prompts)
    }
  }
}
