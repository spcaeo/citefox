import type { IntervalDays, Market, SampleCount } from '@shared/domain'

/** Fields the page header renders. Built from a page detail or a pinned row. */
export interface PageChrome {
  label: string
  title: string
  displayUrl: string
  href: string
  markets: readonly Market[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptSetVersion: number | null
  promptCount: number
}
