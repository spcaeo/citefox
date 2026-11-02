import { translateStage } from '@shared/import-fields'
import type { HelpFillResult, HelpFillRow } from '@shared/ipc'
import { runMockAssist } from '../assist/mock'
import type { HelpFillSource } from '../ui'
import { splitPaste } from './utils/rows'

/**
 * ✦ Help me write on the in-memory mock (the Vite harness and the e2e mock
 * build). Main's reader and prompt builder need a real project, so the mock
 * answers with a short fixed prompt, the canned `prompts.more` rows and a plain
 * reading of the paste (a sheet paste, or one question per line). Main does the
 * real merging; here nothing is merged or set aside.
 */
export function mockHelpFillSource(): HelpFillSource {
  return {
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: true,
      calls: 1,
      costText: '1 AI call · on your AI plan',
      reason: null
    }),
    'helpfill:prompt': async ({ kind, count }) => ({
      kind,
      prompt: [
        'You help a company find the questions its buyers type into Google.',
        'Business: textbolt.com.',
        '',
        `Write ${count ?? 15} new questions a buyer would really type: a situation plus a need.`,
        'Reply with CSV only, this header:',
        'question,stage,page'
      ].join('\n'),
      columns: ['question', 'stage', 'page'],
      tracked: 0
    }),
    'helpfill:describe': async ({ kind, projectId, scope, count, sentence }) => {
      const answer = await runMockAssist({
        assistId: 'prompts.more',
        projectId,
        pageId: scope.pageId,
        marketId: null,
        promptId: null,
        inputs: { count },
        instruction: sentence || null
      })
      return result(
        kind,
        answer.items.map((item) => {
          const stage = translateStage(item.tag ?? '', {})
          return { question: item.text, stage: stage === 'unknown' ? '' : stage, page: '' }
        })
      )
    },
    'helpfill:read': async ({ kind, text }) => {
      const pasted = splitPaste(text)
      const rows =
        pasted !== null && pasted.length > 0
          ? pasted.map((row) => ({
              question: row.question ?? '',
              stage: row.stage ?? '',
              page: row.page ?? ''
            }))
          : text
              .split(/\r?\n/u)
              .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '').trim())
              .filter((line) => line.length > 0)
              .map((question) => ({ question, stage: '', page: '' }))
      return result(kind, rows)
    }
  }
}

function result(kind: string, values: readonly Record<string, string>[]): HelpFillResult {
  const rows: HelpFillRow[] = values
    .filter((row) => (row.question ?? '').length > 0)
    .map((row, index) => ({ id: `mock-${index + 1}`, section: null, values: row }))
  return {
    kind,
    rows,
    setAside: [],
    counts: { read: rows.length, tracked: 0, repeats: 0, setAside: 0, ready: rows.length },
    noun: ['question', 'questions'],
    brand: null,
    warnings: rows.length === 0 ? ['No table or list was found in the answer.'] : []
  }
}
