import type { CoverageRunList, GapRowState, GapStates } from '@shared/ipc'
import { applyTemplateChoice } from '../templates'
import { ALERTS_PAGE_ID, PROMPT_SEEDS, alertsGaps } from '../textboltPage'
import type { SetupContext } from './context'
import { blankGaps, channelError, withStale } from './helpers'
import type { SetupStore } from './types'

/** `gaps:*` and `coverage:*` channels. */
export function createGapMethods(
  ctx: SetupContext
): Pick<
  SetupStore,
  | 'getGaps'
  | 'generateGaps'
  | 'setGapDone'
  | 'redoGap'
  | 'listCoverage'
  | 'getCoverage'
  | 'getGapStates'
  | 'updateGapDraft'
  | 'setGapStatus'
> {
  const { now, requirePage, stateFor } = ctx
  /** The person's gap edits per page, keyed by prompt (as `gap_states`). */
  const edits = new Map<string, Map<string, GapRowState>>()
  const statesOf = (pageId: string): GapStates => ({
    pageId,
    states: [...(edits.get(pageId)?.values() ?? [])].sort((a, b) =>
      a.promptId.localeCompare(b.promptId)
    )
  })
  const write = (pageId: string, promptId: string, patch: Partial<GapRowState>): void => {
    const page = edits.get(pageId) ?? new Map<string, GapRowState>()
    edits.set(pageId, page)
    const current = page.get(promptId) ?? {
      promptId,
      status: null,
      publishedUrl: null,
      faq: null,
      updatedAt: now()
    }
    const next = { ...current, ...patch, updatedAt: now() }
    if (next.status === null && next.publishedUrl === null && next.faq === null) {
      page.delete(promptId)
    } else page.set(promptId, next)
  }
  return {
    getGaps(request) {
      requirePage(request, 'gaps:get')
      const gaps = stateFor(request.pageId).gaps
      if (!gaps) return null
      return withStale(gaps, stateFor(request.pageId).read)
    },

    async generateGaps(request) {
      const state = requirePage(request, 'gaps:generate')
      if (!state.read || state.read.nextStep !== null) {
        throw channelError('gaps:generate', 'Read the page before the coverage matrix.')
      }
      if (state.prompts.working.length === 0) {
        throw channelError('gaps:generate', 'Write prompts before the coverage matrix.')
      }
      const explicitTemplate = request.templateId !== undefined
      if (
        !explicitTemplate &&
        state.gaps &&
        state.gaps.contentHash === state.read.contentHash &&
        state.gaps.rows.length === state.prompts.working.length
      ) {
        state.gaps = { ...state.gaps, reused: true }
        return withStale(state.gaps, state.read)
      }
      const chosen = await applyTemplateChoice(
        'coverage',
        request.templateId,
        'gaps:generate',
        request.projectId,
        request.pageId,
        'coverageMatrices'
      )
      const matrix =
        request.pageId === ALERTS_PAGE_ID && state.prompts.working.length === PROMPT_SEEDS.length
          ? alertsGaps()
          : blankGaps(request.pageId, state.read, state.prompts.working)
      matrix.templateId = chosen.templateId
      matrix.templateName = chosen.templateName
      matrix.templateHash = chosen.templateHash
      matrix.templateUpdatedAt = chosen.templateUpdatedAt
      matrix.recordedAt = now()
      matrix.reused = false
      state.gaps = matrix
      return withStale(matrix, state.read)
    },

    setGapDone(request) {
      const state = requirePage(request, 'gaps:setDone')
      if (!state.gaps) throw channelError('gaps:setDone', 'There is no coverage matrix yet.')
      const row = state.gaps.rows.find((item) => item.promptId === request.promptId)
      if (!row) throw channelError('gaps:setDone', 'That prompt is not in this matrix.')
      row.done = request.done
      write(request.pageId, request.promptId, {
        status: null,
        ...(request.done ? {} : { publishedUrl: null })
      })
      return withStale(state.gaps, state.read)
    },

    getGapStates(request) {
      requirePage(request, 'gaps:getStates')
      return statesOf(request.pageId)
    },

    updateGapDraft(request) {
      const state = requirePage(request, 'gaps:updateDraft')
      if (!state.gaps?.rows.some((row) => row.promptId === request.promptId)) {
        throw channelError('gaps:updateDraft', 'That prompt is not in this matrix.')
      }
      const answer = request.answer.trim()
      write(request.pageId, request.promptId, {
        faq: request.reset
          ? null
          : {
              question: request.question.trim(),
              answer,
              wordCount: answer ? answer.split(/\s+/).length : 0
            }
      })
      return statesOf(request.pageId)
    },

    setGapStatus(request) {
      const state = requirePage(request, 'gaps:setStatus')
      if (!state.gaps) throw channelError('gaps:setStatus', 'There is no coverage matrix yet.')
      for (const promptId of request.promptIds) {
        const row = state.gaps.rows.find((item) => item.promptId === promptId)
        if (!row) throw channelError('gaps:setStatus', 'That prompt is not in this matrix.')
        row.done = request.status !== 'open'
        write(request.pageId, promptId, {
          status: request.status,
          ...(request.status === 'open'
            ? { publishedUrl: null }
            : request.publishedUrl !== undefined
              ? { publishedUrl: request.publishedUrl }
              : {})
        })
      }
      return statesOf(request.pageId)
    },

    redoGap(request) {
      const state = requirePage(request, 'gaps:redo')
      if (!state.gaps) throw channelError('gaps:redo', 'There is no coverage matrix yet.')
      const row = state.gaps.rows.find((item) => item.promptId === request.promptId)
      if (!row) throw channelError('gaps:redo', 'That prompt is not in this matrix.')
      row.done = false
      state.gaps = { ...state.gaps, recordedAt: now(), reused: false }
      return withStale(state.gaps, state.read)
    },

    listCoverage(request) {
      requirePage(request, 'coverage:list')
      const gaps = stateFor(request.pageId).gaps
      const result: CoverageRunList = {
        pageId: request.pageId,
        runs: gaps
          ? [
              {
                runId: gaps.runId,
                pageId: gaps.pageId,
                recordedAt: gaps.recordedAt,
                contentHash: gaps.contentHash
              }
            ]
          : []
      }
      return result
    },

    getCoverage(request) {
      const state = requirePage(request, 'coverage:get')
      if (!state.gaps || state.gaps.runId !== request.runId) {
        throw channelError('coverage:get', 'That coverage run is not stored for this page.')
      }
      return withStale(state.gaps, state.read)
    }
  }
}
