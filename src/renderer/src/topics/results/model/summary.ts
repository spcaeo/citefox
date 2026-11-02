import { TOPIC_STAGE_LABEL } from '../constants'
import type { TopicResults } from '../types'
import { formatDate } from './format'
import { promptLabel, rowsById } from './scoring'

/** The line to show: the saved Claude line, else one built from the summary inputs. */
export function summaryText(results: TopicResults): { lead: string; text: string } | null {
  const saved = results.savedSummary?.text?.trim()
  if (saved) {
    const at = saved.indexOf(':')
    return at > 0 && at < 40
      ? { lead: `${saved.slice(0, at)}:`, text: saved.slice(at + 1).trim() }
      : { lead: '', text: saved }
  }
  const inputs = results.summaryInputs
  if (!inputs.sinceAt) return null
  const parts: string[] = []
  const change = inputs.questionsCitedChange
  if (change !== null) {
    parts.push(
      change === 0
        ? 'No change in cited questions.'
        : `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} cited.`
    )
  }
  if (inputs.weakestStage) {
    const weak = inputs.weakestStage
    parts.push(`${TOPIC_STAGE_LABEL[weak.stage]} is weakest, ${weak.cited} of ${weak.withAio}.`)
  }
  // Lead with questions when the topic has any; keywords are scored apart.
  const lead = results.goals.questions.prompts > 0 ? 'question' : 'keyword'
  const next = rowsById(results.rows, inputs.next)
    .filter((row) => row.kind === lead)
    .slice(0, 2)
    .map(promptLabel)
  if (next.length > 0) parts.push(`Next: ${next.join(' and ')}.`)
  if (parts.length === 0) return null
  return { lead: `Since ${formatDate(inputs.sinceAt)}:`, text: parts.join(' ') }
}
