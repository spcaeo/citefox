import { useMemo, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import { formatDay } from '../../utils/dates'
import { KpiStrip, KpiTile } from '../../ui'
import { kpiTrend } from '../model'
import { useWidgetMetrics, type WidgetEnv } from './env'
import { metricRowsDrill, rowsOf, widgetScope } from './metricDrills'
import { WidgetNote } from './WidgetCard'

/**
 * Headline numbers under All engines (owner option A, Docs/METRICS.md): each question
 * counts once, cited when any engine cites your site. Read from the shared metrics, so
 * they equal Reports → Visibility report's "Where you stand"; every number opens exactly
 * its rows.
 */
export function AllHeadline({ env }: { env: WidgetEnv }): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, 'all')
  const result = metrics.data
  const drills = useMemo(() => {
    if (result === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    const make = (
      id: string,
      title: string,
      description: string,
      ids: readonly string[]
    ): ItemDrill =>
      metricRowsDrill(
        rowsOf(result, ids),
        { id: `w:headline:all:${id}`, title, description },
        scope
      )
    const now = result.now
    const movement = result.comparison?.movement ?? null
    return {
      checked: make(
        'checked',
        'Questions tracked',
        'Every question at its latest check, counted once across engines.',
        now.checked.ids
      ),
      answered: make(
        'answered',
        'Questions with an AI answer',
        'An AI answer showed on at least one engine at the latest check.',
        now.answered.ids
      ),
      cited: make(
        'cited',
        'Questions where you’re cited',
        'At least one engine’s AI answer cites a page of yours.',
        now.cited.ids
      ),
      named: make(
        'named',
        'Questions where you’re named',
        'At least one engine’s AI answer names your brand in its text.',
        now.named.ids
      ),
      gained:
        movement === null
          ? null
          : make(
              'gained',
              'Questions gained',
              'Not cited by any engine at the check before, cited now.',
              movement.gained.ids
            ),
      lost:
        movement === null
          ? null
          : make(
              'lost',
              'Questions lost',
              'Cited by an engine at the check before, by none now.',
              movement.lost.ids
            ),
      moved:
        movement === null
          ? null
          : make(
              'moved',
              'Questions that moved',
              'Gained or lost since each question’s check before.',
              [...movement.gained.ids, ...movement.lost.ids]
            )
    }
  }, [result, env.data, env.marketLabel])

  if (result === null || drills === null) {
    return <WidgetNote loading={metrics.loading} error={metrics.error} />
  }
  const number = (drill: ItemDrill, text: string, suffix?: string, lead = ''): JSX.Element => (
    <DrillNumber
      drill={drill}
      label={
        suffix
          ? `${drill.items.length}${suffix}: ${pluralize(drill.items.length, 'question')}`
          : `${lead}${pluralize(drill.items.length, 'question')} ${text}`
      }
      {...(suffix ? { suffix } : {})}
    />
  )
  const gained = drills.gained?.items.length ?? 0
  const lost = drills.lost?.items.length ?? 0
  const trend = kpiTrend(gained - lost === 0 ? null : gained - lost)
  const moved = drills.moved
  const lastAt = result.checks.at(-1)?.at ?? null
  return (
    <KpiStrip label="Headline numbers" className="ov-kpis">
      <KpiTile
        label="Questions tracked"
        value={number(drills.checked, 'tracked')}
        sub={
          lastAt === null
            ? 'Not checked yet'
            : `Checked ${formatDay(lastAt, { year: false })} · ${env.marketLabel}`
        }
      />
      <KpiTile
        label="AI answer shows"
        value={number(drills.answered, 'with an AI answer')}
        suffix={<>of {number(drills.checked, 'tracked', undefined, 'of ')}</>}
      />
      <KpiTile
        label="You’re cited"
        value={number(drills.cited, 'where you’re cited')}
        suffix={<>of {number(drills.answered, 'with an AI answer', undefined, 'of ')}</>}
        {...(trend ? { trend } : {})}
        {...(trend && moved !== null && moved.items.length > 0
          ? {
              renderTrend: (chip) => (
                <DrillButton
                  drill={moved}
                  className="ov-trend-btn"
                  label={`${trend.text} since the check before: open the ${moved.items.length} that moved`}
                  untracked
                >
                  {chip}
                </DrillButton>
              )
            }
          : {})}
        sub={
          drills.gained !== null && drills.lost !== null && (gained > 0 || lost > 0) ? (
            <>
              {number(drills.gained, 'gained', ' gained')} · {number(drills.lost, 'lost', ' lost')}
            </>
          ) : undefined
        }
      />
      <KpiTile
        label="You’re named"
        value={number(drills.named, 'where you’re named')}
        sub="In the answer, not its sources"
      />
    </KpiStrip>
  )
}
