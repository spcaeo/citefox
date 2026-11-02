import type { WidgetKind, WidgetSize } from '@shared/summary-board'

/**
 * What each widget is, in the "+ Add widget" gallery and on its card: its name, one line
 * on what it shows, the sizes it fits and whether it has its own engine filter.
 */
export interface WidgetInfo {
  kind: WidgetKind
  title: string
  /** One plain line for the gallery. */
  description: string
  sizes: readonly WidgetSize[]
  defaultSize: WidgetSize
  /** True: the widget's numbers follow its own engine filter. */
  engines: boolean
  /** What the widget needs picking before it can be added. */
  needs: 'domain' | 'question' | null
}

export const WIDGET_INFO: Readonly<Record<WidgetKind, WidgetInfo>> = {
  headline: {
    kind: 'headline',
    title: 'Headline numbers',
    description: 'AI answers shown, where you’re cited and named, and your citation share.',
    sizes: ['w', 'l'],
    defaultSize: 'w',
    engines: true,
    needs: null
  },
  results: {
    kind: 'results',
    title: 'Results at a glance',
    description: 'Where the latest checks ended, and how many searches need work.',
    sizes: ['w', 'm', 'l'],
    defaultSize: 'w',
    engines: true,
    needs: null
  },
  trend: {
    kind: 'trend',
    title: 'Trend with markers',
    description: 'Searches citing you over time, with your fixes, Google updates and page changes.',
    sizes: ['l', 'w', 'm'],
    defaultSize: 'l',
    engines: true,
    needs: null
  },
  'cited-sites': {
    kind: 'cited-sites',
    title: 'Who gets cited',
    description: 'The sites AI answers cite most, with you marked.',
    sizes: ['m', 'l', 'w'],
    defaultSize: 'm',
    engines: true,
    needs: null
  },
  'next-fixes': {
    kind: 'next-fixes',
    title: 'Next fixes',
    description: 'The page fixes that would win the most searches.',
    sizes: ['m', 'l', 'w'],
    defaultSize: 'm',
    engines: false,
    needs: null
  },
  changes: {
    kind: 'changes',
    title: 'Questions that changed',
    description: 'Questions you gained or lost since the compared check.',
    sizes: ['w', 'l'],
    defaultSize: 'w',
    engines: true,
    needs: null
  },
  'cited-rate': {
    kind: 'cited-rate',
    title: 'Cited rate',
    description: 'Of the AI answers shown, the share that cite you.',
    sizes: ['s', 'm'],
    defaultSize: 's',
    engines: true,
    needs: null
  },
  'fixes-working': {
    kind: 'fixes-working',
    title: 'Fixes working',
    description: 'Your logged fixes: worked, too early to tell, or no change.',
    sizes: ['s', 'm', 'l'],
    defaultSize: 'm',
    engines: false,
    needs: null
  },
  engines: {
    kind: 'engines',
    title: 'Engines side by side',
    description: 'Where each AI engine cites you, next to each other.',
    sizes: ['m', 'w', 'l'],
    defaultSize: 'm',
    engines: false,
    needs: null
  },
  competitor: {
    kind: 'competitor',
    title: 'Competitor watch',
    description: 'One competitor: the questions where AI answers cite them and not you.',
    sizes: ['m', 's', 'l'],
    defaultSize: 'm',
    engines: true,
    needs: 'domain'
  },
  'google-updates': {
    kind: 'google-updates',
    title: 'Google updates',
    description: 'Google’s latest updates and how your cited searches moved around them.',
    sizes: ['m', 'l', 'w'],
    defaultSize: 'm',
    engines: true,
    needs: null
  },
  credits: {
    kind: 'credits',
    title: 'Searches and credits',
    description: 'Searches left, and the checks and credits used this month.',
    sizes: ['s', 'm'],
    defaultSize: 's',
    engines: true,
    needs: null
  },
  'page-changes': {
    kind: 'page-changes',
    title: 'Page changes nobody logged',
    description: 'Pages that changed without a logged fix: log them so results read right.',
    sizes: ['m', 's', 'l', 'w'],
    defaultSize: 'm',
    engines: false,
    needs: null
  },
  question: {
    kind: 'question',
    title: 'A pinned question',
    description: 'One buyer question: its latest answer and the sites it cites.',
    sizes: ['m', 'l', 'w'],
    defaultSize: 'm',
    engines: true,
    needs: 'question'
  }
}

/** The gallery's order. */
export const GALLERY_ORDER: readonly WidgetKind[] = [
  'cited-rate',
  'trend',
  'fixes-working',
  'next-fixes',
  'engines',
  'competitor',
  'google-updates',
  'credits',
  'page-changes',
  'question',
  'headline',
  'results',
  'cited-sites',
  'changes'
]

export const SIZE_LABEL: Readonly<Record<WidgetSize, string>> = {
  s: 'Small',
  m: 'Medium',
  l: 'Large',
  w: 'Wide'
}
