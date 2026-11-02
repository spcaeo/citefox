import type { LocalChartMarker } from './trends'

/** Harness and tests only. Production screens do not import this module. */
export function markersFor(pageId: string): readonly LocalChartMarker[] {
  if (pageId !== 'alerts' && pageId !== 'textbolt-alerts') return []
  return SAMPLE_MARKERS
}

const SAMPLE_MARKERS: readonly LocalChartMarker[] = [
  {
    at: '2026-10-08T16:00:00.000Z',
    chartTitle: 'Fix 1 · Oct 8',
    chartDetail: 'Added 5 FAQs',
    event: 'Fix 1 · Added 5 FAQs',
    promptsLabel: null,
    trendNote: '—',
    planned: false,
    changeNote: 'Page content changed in this period: Fix 1 went live Oct 8.',
    band: 'fix',
    promptIds: ['tb-4', 'tb-6', 'tb-9']
  },
  {
    at: '2026-10-21T16:00:00.000Z',
    chartTitle: 'Fix 2 · Oct 21',
    chartDetail: 'planned',
    event: 'Fix 2 goes live (planned)',
    promptsLabel: null,
    trendNote: '—',
    planned: true,
    changeNote: null,
    band: 'fix',
    promptIds: ['tb-4', 'tb-5']
  },
  {
    at: '2026-10-24T16:00:00.000Z',
    chartTitle: 'Follow-up',
    chartDetail: 'planned',
    event: 'Follow-up for Fix 2 (planned)',
    promptsLabel: '2 of 10',
    trendNote: 'No, partial check',
    planned: true,
    changeNote: null,
    band: 'plan',
    promptIds: ['tb-4', 'tb-5']
  },
  {
    at: '2026-11-02T16:00:00.000Z',
    chartTitle: 'Next full check',
    chartDetail: 'planned',
    event: 'Next scheduled check',
    promptsLabel: '10 of 10',
    trendNote: 'Yes, once it runs',
    planned: true,
    changeNote: null,
    band: 'plan',
    promptIds: ['tb-1', 'tb-2', 'tb-3', 'tb-4', 'tb-5', 'tb-6', 'tb-7', 'tb-8', 'tb-9', 'tb-10']
  }
]
