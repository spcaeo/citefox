import type { LoggedFix } from '@shared/domain'
import type { ItemDrill } from '../drill'
import { resultLabel } from '../progress/model'
import { targetedQuestions } from './model'

/**
 * The questions a fix should help (the Questions cell): one row per targeted prompt,
 * so the drawer total equals the number. Each row opens its prompt detail. Pure.
 */
export function fixQuestionsDrill(fix: LoggedFix, subject: string): ItemDrill {
  const outcomes = new Map(targetedQuestions(fix).map((item) => [item.promptId, item]))
  return {
    kind: 'items',
    id: `fix:questions:${fix.id}`,
    title: `Questions Fix ${fix.number} should help`,
    description: subject ? `On ${subject}.` : '',
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [{ id: 'result', label: 'Result', width: 'minmax(96px, 0.4fr)' }],
    items: fix.promptIds.map((promptId) => {
      const outcome = outcomes.get(promptId)
      return {
        id: promptId,
        primary: outcome?.text || 'A question no longer in the set',
        secondary: outcome ? outcome.label || `Q${outcome.promptPosition}` : null,
        target: { kind: 'prompt' as const, pageId: fix.pageId, promptId },
        cells: {
          result: fix.status === 'completed' && outcome ? resultLabel(outcome.result) : 'Waiting'
        }
      }
    }),
    scope: {
      pageId: fix.pageId,
      marketId: null,
      runId: null,
      marketLabel: '',
      checkDateLabel: '',
      brand: '',
      domain: ''
    }
  }
}
