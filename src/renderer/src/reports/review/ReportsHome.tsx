import { useMemo, type JSX } from 'react'
import type { MetricsRequest } from '@shared/ipc'
import { isRivalSite, rivalOrder, ONE_CHECK_KINDS, type ReportKind } from '@shared/report/review'
import { TabPanel, useScreenView, ViewTabs } from '../../ui'
import { formatDay, formatMoment } from '../../utils/dates'
import type { ReviewClient } from './client'
import { useBrandingMode } from '../branding/senderStore'
import { GoalsView, type OpenGoal } from './GoalsView'
import { HomeCard, type CardEnv } from './HomeCard'
import { useReviewData } from './useReviewData'
import { BrandingStrip } from '../branding/BrandingStrip'
import type { ReviewProject } from './ReviewView'

/**
 * Reports → Ready reports (the approved mock-up): six finished reports, rebuilt after
 * every check. Open shows it here; Download saves the same report as one offline file
 * with the same numbers.
 */
export function ReportsHome({
  client,
  project,
  onOpen,
  onSchedule
}: {
  client: ReviewClient
  project: ReviewProject
  onOpen: OpenGoal
  onSchedule: (kind: ReportKind) => void
}): JSX.Element {
  // Two views of the same reports (owner 2026-11-02): by goal (default) or by report.
  const screen = useScreenView<HomeView>('reports-home', HOME_VIEWS, 'goals', {
    projectId: project.id,
    param: 'layout'
  })
  const request = useMemo<MetricsRequest>(
    () => ({
      projectId: project.id,
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      from: 'first',
      to: null
    }),
    [project.id]
  )
  const ctx = useMemo(
    () => ({
      brand: project.brand,
      domain: project.domain,
      kind: 'impact' as const,
      day: formatDay,
      marketLabel: '',
      engineLabel: 'all engines'
    }),
    [project.brand, project.domain]
  )
  const data = useReviewData(client, request, ctx)
  const mode = useBrandingMode()
  const report = data.report
  const metrics = data.metrics
  const now = metrics?.now
  const comparison = metrics?.comparison ?? null
  const last = metrics?.checks.at(-1)?.at ?? null
  const published = report?.published.rows ?? []
  const net = comparison === null ? 0 : comparison.after.cited.n - comparison.before.cited.n
  // One check compared with itself says nothing; wait for the second check.
  const checks = metrics?.checks.length ?? 0
  const reading = report === null || metrics === null
  const bar = (id: string): number =>
    report?.visibility.opportunity.bars.find((item) => item.id === id)?.value.n ?? 0
  const topRival = (report?.competition.sites ?? []).filter(isRivalSite).sort(rivalOrder)[0] ?? null
  const toWin = now ? Math.max(0, now.answered.n - now.cited.n) + bar('wrongpage') : 0
  const env: CardEnv = {
    client,
    requestFor: (kind) => (ONE_CHECK_KINDS.has(kind) ? { ...request, from: null } : request),
    onSchedule
  }
  return (
    <div className="rv-home">
      <div className="rb-home-top">
        {last !== null ? (
          <p className="rv-muted rv-small">Last check {formatMoment(last)}</p>
        ) : (
          <span />
        )}
        <BrandingStrip branding={report?.branding} brand={project.brand} />
      </div>
      {data.problem ? <p className="rv-saved rv-saved-bad">{data.problem}</p> : null}
      <ViewTabs<HomeView>
        label="Reports views"
        panelId={HOME_PANEL}
        views={[
          { id: 'goals', label: 'By goal', icon: 'target' },
          { id: 'reports', label: 'By report', icon: 'grid' }
        ]}
        value={screen.view}
        onChange={screen.setView}
        hrefFor={screen.hrefFor}
      />
      <TabPanel panelId={HOME_PANEL} id={screen.view}>
        {screen.view === 'goals' ? (
          <GoalsView report={report} metrics={metrics} onOpen={onOpen} env={env} mode={mode} />
        ) : (
          <div className="rv-cards">
            <HomeCard
              kind="visibility"
              title="Visibility report"
              line="Where you stand now, and who wins instead."
              reading={reading}
              peek={
                now ? (
                  <>
                    <b className="num">
                      {now.cited.n} of {now.checked.n}
                    </b>{' '}
                    cite you · {now.answered.n} show an AI answer
                  </>
                ) : null
              }
              meta={
                <>
                  {last ? `Latest check, ${formatMoment(last)}` : 'Latest check'} ·{' '}
                  <a
                    className="rv-link"
                    href="#/export"
                    data-full-report=""
                    title="The older full report (Google AI Overviews only)"
                  >
                    Full report →
                  </a>
                </>
              }
              onOpen={() => onOpen('visibility')}
              env={env}
            />
            <HomeCard
              kind="changed"
              title="What changed"
              line="Any two checks compared, verdict first."
              reading={reading}
              waiting={checks < 2 ? 'Needs a 2nd check' : null}
              peek={
                checks < 2 ? (
                  <>One check so far{last ? ` (${formatMoment(last)})` : ''}.</>
                ) : comparison ? (
                  <>
                    <b className="num">
                      {net >= 0 ? '+' : '−'}
                      {Math.abs(net)}
                    </b>{' '}
                    questions · {comparison.movement.gained.n} gained, {comparison.movement.lost.n}{' '}
                    lost
                  </>
                ) : null
              }
              meta={
                checks >= 2 && report?.fromLabel ? `${report.fromLabel} → ${report.toLabel}` : null
              }
              onOpen={() => onOpen('changed')}
              env={env}
            />
            <HomeCard
              kind="impact"
              title="Impact review"
              line="What your published pages did."
              reading={reading}
              waiting={published.length === 0 ? 'Needs a logged fix' : null}
              peek={
                published.length === 0 ? (
                  <>No fixes logged yet.</>
                ) : report ? (
                  <>
                    <b className="num">{published.length}</b> pages published ·{' '}
                    {published.filter((page) => page.now > 0).length} cited already
                  </>
                ) : null
              }
              meta={report && published.length > 0 ? report.verdict.badge.label : null}
              onOpen={() => onOpen('impact')}
              env={env}
            />
            <HomeCard
              kind="pitch"
              title="Pitch / audit"
              line="A short audit from one check."
              reading={reading}
              peek={
                report ? (
                  <>
                    <b className="num">{bar('invisible')}</b> invisible ·{' '}
                    <b className="num">{bar('wrongpage')}</b> wrong page
                  </>
                ) : null
              }
              onOpen={() => onOpen('pitch')}
              env={env}
            />
            <HomeCard
              kind="content"
              title="Content plan"
              line="The pages to write or fix next."
              reading={reading}
              peek={
                now ? (
                  <>
                    <b className="num">{toWin}</b> questions to win
                  </>
                ) : null
              }
              onOpen={() => onOpen('content')}
              env={env}
            />
            <HomeCard
              kind="rival"
              title="Head-to-head"
              line="You against one competitor."
              reading={reading}
              waiting={report && topRival === null ? 'No other sites cited yet' : null}
              peek={
                topRival ? (
                  <>
                    <b className="num">{topRival.gap?.n ?? 0}</b> questions cite {topRival.domain},
                    not you
                  </>
                ) : null
              }
              openDisabled={report !== null && topRival === null}
              onOpen={() => onOpen('rival')}
              env={env}
            />
          </div>
        )}
      </TabPanel>
      <p className="rv-note">
        <b>No setup.</b> Rebuilt after each check; downloads show the same numbers.
      </p>
    </div>
  )
}

type HomeView = 'goals' | 'reports'
const HOME_VIEWS: readonly HomeView[] = ['goals', 'reports']
const HOME_PANEL = 'reports-home'
