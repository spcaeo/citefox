import type { PromptTextRules, QuestionRow, QuestionSource } from '@shared/ipc'

/** The wording rules for a row, as the engine checks them (prompt-reword `textRules`). */
export function rowRules(
  row: QuestionRow,
  source: QuestionSource | undefined,
  brands: readonly string[]
): PromptTextRules {
  if (source?.kind === 'topic') {
    return {
      kind: row.promptKind === 'keyword' ? 'keyword' : 'question',
      minWords: 1,
      maxWords: 32,
      brands
    }
  }
  return { kind: 'buyer_prompt', minWords: 8, maxWords: 32, brands }
}
