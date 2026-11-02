import type { PageSummary } from '@shared/domain'
import {
  QUESTION_SEARCH_LIMIT,
  type QuestionSearchHit,
  type SearchQuestionsRequest,
  type SearchQuestionsResult
} from '@shared/ipc'
import { pageLabel } from '../projects/copy'
import type { ShellClient } from '../projects/client'

/**
 * The channel the top bar search uses for questions. Production uses the preload
 * allow-list; tests and harness pages pass another `QuestionSearchSource`. It is
 * apart from `ShellClient` so the shell's many test clients need not grow a method.
 */
export interface QuestionSearchSource {
  'search:questions'(request: SearchQuestionsRequest): Promise<SearchQuestionsResult>
}

export function createQuestionSearchSource(): QuestionSearchSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'search:questions': async (request) => {
      if (typeof window === 'undefined' || !window.citefox) {
        throw new Error('The preload bridge is missing.')
      }
      return window.citefox['search:questions'](request)
    }
  }
}

/** Pages whose questions count as tracked, as `search:questions` reads them. */
const SEARCHED = new Set<PageSummary['status']>(['tracked', 'setting_up', 'paused'])

/**
 * The same lookup over a shell client's pages and prompt sets, for the in-memory
 * mock client (whose projects the engine does not have). It follows the engine's
 * rules: every word in one market wording, `**` ignored, earliest match first,
 * then the shorter question. Mock and harness use only; it reads every set.
 */
export function createShellQuestionSearch(
  shell: Pick<ShellClient, 'listPages' | 'listPrompts'>
): QuestionSearchSource {
  return {
    'search:questions': async ({ projectId, query }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      if (words.length === 0) return { questions: [], more: false }
      const phrase = words.join(' ')
      const { pages } = await shell.listPages({ projectId })
      const sets = await Promise.allSettled(
        pages
          .filter((page) => SEARCHED.has(page.status))
          .map(async (page) => ({
            page,
            set: await shell.listPrompts({ projectId, pageId: page.id })
          }))
      )
      const found: Array<{ hit: QuestionSearchHit; at: number }> = []
      for (const settled of sets) {
        if (settled.status !== 'fulfilled') continue
        const { page, set } = settled.value
        for (const prompt of set.prompts) {
          const variant = prompt.variants.find((item) => {
            const text = item.text.toLowerCase().split('**').join('')
            return words.every((word) => text.includes(word))
          })
          if (!variant) continue
          const at = variant.text.toLowerCase().split('**').join('').indexOf(phrase)
          found.push({
            at: at < 0 ? Number.MAX_SAFE_INTEGER : at,
            hit: {
              promptId: prompt.id,
              sourceId: page.id,
              sourceKind: page.kind === 'topic' ? 'topic' : 'page',
              sourceName: pageLabel(page),
              text: variant.text
            }
          })
        }
      }
      found.sort((a, b) => a.at - b.at || a.hit.text.length - b.hit.text.length)
      return {
        questions: found.slice(0, QUESTION_SEARCH_LIMIT).map((item) => item.hit),
        more: found.length > QUESTION_SEARCH_LIMIT
      }
    }
  }
}
