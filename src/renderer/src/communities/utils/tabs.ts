import type { CommunitiesReport } from '@shared/domain'
import type { SourceTab } from '../types'

/** The four source lists, as top-level tabs of the Communities screen. */
export const SOURCE_TABS: readonly { id: SourceTab; label: string }[] = [
  { id: 'reddit', label: 'Reddit' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'forums', label: 'Other forums' }
]

/** How many cited sources a tab lists. */
export function sourceCount(report: CommunitiesReport, tab: SourceTab): number {
  if (tab === 'reddit') return report.reddit.length
  if (tab === 'youtube') return report.youtube.length
  if (tab === 'linkedin') return report.linkedin.length
  return report.forums.length
}

/** The screen's sections: the source mix, the four source lists, opportunities. */
export type CommunitiesTab = 'mix' | SourceTab | 'opportunities'

const TAB_IDS: readonly CommunitiesTab[] = [
  'mix',
  ...SOURCE_TABS.map((item) => item.id),
  'opportunities'
]

/** The section named by the route's `?view=`. Missing or unknown is the source mix. */
export function tabFromView(view: string | null): CommunitiesTab {
  return TAB_IDS.find((id) => id === view) ?? 'mix'
}
