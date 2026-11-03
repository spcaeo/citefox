import type { SummaryStyle } from '@shared/domain'
import { allowedNumbers, unknownNumbers } from '../assistant/numbers'
import { REPORT_WRITING_RULES } from '../prompts/blocks'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { SummaryWriter } from './types'

const STYLE_RULES: Record<SummaryStyle, string> = {
  standard:
    'Write a short summary for the site owner: two or three sentences on where the pages stand, then the one thing to do next.',
  client_friendly:
    'Write a short summary for a client who does not work in SEO: plain words, no jargon, two or three sentences, then the one thing to do next.'
}

/** The rewrite prompt. Only the report's own numbers go in. */
export function summaryPrompt(style: SummaryStyle, facts: string): string {
  return [
    'Rewrite this scheduled report email summary.',
    STYLE_RULES[style],
    'Start with the headline sentence from the facts. You may reword it, but keep its numbers.',
    REPORT_WRITING_RULES,
    'Do not invent figures, sites or causes. Plain text, no Markdown headings.',
    '',
    'Report facts:',
    facts.trim()
  ].join('\n')
}

/**
 * Scheduled reports with a summary style ("Write the summary with Claude",
 * "Make it client-friendly") are rewritten by Claude just before they are sent.
 * A rewrite that quotes a number the facts do not hold is not used: the email goes out
 * with the facts as written by code, so it never carries an invented number.
 * `open` returns Settings' Claude connection, or undefined when none can run;
 * a throw here makes the send record "The email summary was not rewritten."
 */
export function claudeSummaryWriter(open: () => ClaudeProvider | undefined): SummaryWriter {
  return {
    async write({ style, facts }) {
      const provider = open()
      if (provider === undefined) throw new Error('CiteFox AI is not set up.')
      const reply = await provider.complete({
        prompt: summaryPrompt(style, facts),
        trace: {
          source: 'report',
          projectId: null,
          templateKind: null,
          templateId: null,
          templateHash: null,
          assistId: null
        },
        schema: null
      })
      const text = reply.text.trim()
      if (text === '') throw new Error('CiteFox AI returned no summary.')
      return unknownNumbers(text, allowedNumbers(facts)).length > 0 ? facts : text
    }
  }
}
