import type {
  BucketItem,
  FunnelStep,
  HistoryCell,
  MoverItem,
  PairedItem,
  RankedItem,
  SplitPart
} from '@shared/charts'

/**
 * Sample data for the report charts board in the gallery: the TextBolt impact
 * review from the approved Reports mock-up (Sep 16 → Oct 28).
 */

export const BEFORE = 'Sep 16'
export const NOW = 'Oct 28'

export const SPLIT: SplitPart[] = [
  {
    id: 'split:market',
    label: 'Market',
    value: 1.6,
    tone: 'none',
    note: '4 questions got an AI answer for the first time'
  },
  {
    id: 'split:work',
    label: 'Your work',
    value: 12.4,
    tone: 'target',
    note: 'your share of AI answers rose from 6% to 22%'
  }
]

export const PAIRED: PairedItem[] = [
  {
    id: 'grp:new:a',
    beforeId: 'grp:new:b',
    label: 'New pages',
    sub: '9 pages',
    before: 0,
    now: 13
  },
  {
    id: 'grp:rewrite:a',
    beforeId: 'grp:rewrite:b',
    label: 'Rewritten pages',
    sub: '3 pages',
    before: 2,
    now: 5
  },
  { id: 'grp:home:a', beforeId: 'grp:home:b', label: 'Home page', before: 4, now: 3 }
]

export const BUCKETS: BucketItem[] = [
  { id: 'bucket:0', label: '0–3 days', value: 0, sub: '0 of 2 pages cited' },
  { id: 'bucket:1', label: '4–7 days', value: 3, sub: '1 of 3 pages cited' },
  { id: 'bucket:2', label: '8–13 days', value: 6, sub: '2 of 3 pages cited' },
  { id: 'bucket:3', label: '14–21 days', value: 9, sub: '3 of 3 pages cited' },
  { id: 'bucket:4', label: '22+ days', value: 4, sub: '1 of 1 page cited' }
]

export const MOVERS: MoverItem[] = [
  { id: 'dom:textbolt.com', label: 'textbolt.com', before: 6, now: 20, highlight: true },
  { id: 'dom:reddit.com', label: 'reddit.com', before: 11, now: 15 },
  { id: 'dom:youtube.com', label: 'youtube.com', before: 4, now: 6 },
  { id: 'dom:g2.com', label: 'g2.com', before: 14, now: 9 },
  { id: 'dom:simpletexting.com', label: 'simpletexting.com', before: 12, now: 8 },
  { id: 'dom:capterra.com', label: 'capterra.com', before: 7, now: 7 },
  {
    id: 'dom:long',
    label: 'a-very-long-review-site-name-that-keeps-going.example.co.uk',
    before: 5,
    now: 2
  }
]

export const RANKED: RankedItem[] = [
  { id: 'rank:textbolt.com', label: 'textbolt.com', value: 20, previous: 6, highlight: true },
  { id: 'rank:reddit.com', label: 'reddit.com', value: 15, previous: 11 },
  { id: 'rank:g2.com', label: 'g2.com', value: 9, previous: 14 },
  { id: 'rank:simpletexting.com', label: 'simpletexting.com', value: 8, previous: 12 },
  { id: 'rank:capterra.com', label: 'capterra.com', value: 7, previous: 7 },
  { id: 'rank:youtube.com', label: 'youtube.com', value: 6, previous: 4 }
]

export const FUNNEL: FunnelStep[] = [
  { id: 'funnel:tracked', label: 'Questions tracked', value: 120 },
  { id: 'funnel:shown', label: 'AI answer shown', value: 106, lostId: 'funnel:lost:shown' },
  { id: 'funnel:cited', label: 'Your site cited', value: 22, lostId: 'funnel:lost:cited' },
  { id: 'funnel:named', label: 'Brand named', value: 14, lostId: 'funnel:lost:named' }
]

/** Your source position in each answer that cites you. */
export const POSITIONS: number[] = [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 5, 6, 7, 9]
export const NOT_CITED = 6

export interface HistoryRow {
  id: string
  question: string
  cells: HistoryCell[]
}

const DATES = ['Sep 16', 'Sep 30', 'Oct 14', 'Oct 28']

function row(id: string, question: string, states: HistoryCell['state'][]): HistoryRow {
  return {
    id,
    question,
    cells: states.map((state, index) => ({
      id: `${id}:check:${index}`,
      date: DATES[index] ?? '',
      state
    }))
  }
}

export const HISTORY: HistoryRow[] = [
  row('q:1', 'best sms marketing tool for small shops', [
    'not-cited',
    'not-cited',
    'target',
    'target'
  ]),
  row('q:2', 'how to send bulk texts from a laptop', ['none', 'not-cited', 'other', 'target']),
  row('q:3', 'textbolt vs simpletexting', ['target', 'target', 'target', 'not-cited']),
  row('q:4', 'two-way business texting app', ['none', 'none', 'missing', 'other'])
]
