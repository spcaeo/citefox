import type { ThreadCheckResult } from '@shared/domain'

/** One sentence for a "Check threads" result. The parts add up to the threads asked for. */
export function threadResultText(result: ThreadCheckResult): string {
  const parts: string[] = []
  parts.push(result.checked === 1 ? 'Read 1 thread' : `Read ${result.checked} threads`)
  if (result.cached > 0) parts.push(`${result.cached} already read today`)
  if (result.failed > 0) parts.push(`${result.failed} could not be read`)
  if (result.skipped > 0) parts.push(`${result.skipped} left for later`)
  const sentence = `${parts.join(', ')}.`
  return result.message === null ? sentence : `${sentence} ${result.message}`
}

/** The line under a Communities header, on the page tab and the project screen. */
export const COMMUNITIES_LEAD = 'The forums, videos and posts AI answers cite for your questions.'
