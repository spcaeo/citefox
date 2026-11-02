import type { OwnerVerdict, OwnerWhyResult } from '@shared/ipc'
import { pathOf } from '../../model'

/** The comparison's verdict as one plain line, naming the page. */
export function verdictLine(verdict: OwnerVerdict, citedUrl: string): string {
  if (verdict === 'cited') return `Make ${pathOf(citedUrl)} the owner`
  if (verdict === 'target') return 'Keep the target and strengthen it'
  return 'Either page can own these searches'
}

/** The "What to change" list as plain text, for a writer. */
export function changesText(why: OwnerWhyResult): string {
  return [
    `What to change on ${why.ownerUrl}`,
    '',
    ...why.toChange.map((item) => `- ${item.section}: ${item.change}\n  Why: ${item.why}`)
  ].join('\n')
}
