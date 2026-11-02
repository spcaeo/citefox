import { projectRulesLines } from '../prompts/project-rules'
import { ASSIST_REPLY_SHAPE, WEB_SEARCH_OUTPUT_RULES } from './preamble'

/**
 * The prompt for an assist that may search the web (`AssistDefinition.webSearch`). Same
 * order as `assistPrompt`, with the web-search rules in place of "use only the saved
 * data", and the inputs headed "Input" (they are short derived lines, not saved data).
 */
export function webAssistPrompt(input: {
  assistId: string
  task: string
  instruction: string | null
  facts: string
  /** The owner's project rules that are on. */
  rules?: readonly string[]
}): string {
  const owner = projectRulesLines(input.rules ?? [])
  const parts = [
    `Assist: ${input.assistId}`,
    WEB_SEARCH_OUTPUT_RULES,
    ...(owner.length > 0 ? ['', ...owner] : []),
    '',
    'Task:',
    input.task.trim()
  ]
  if (input.instruction !== null && input.instruction.trim().length > 0) {
    parts.push('', 'The user asked for this change to your answer:', input.instruction.trim())
  }
  parts.push('', 'Input:', input.facts.trim(), '', ASSIST_REPLY_SHAPE)
  return parts.join('\n')
}
