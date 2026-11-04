import { pageKey } from '@shared/metrics'
import { useState, type JSX } from 'react'
import type { MetricsResult } from '@shared/metrics'
import type { ReviewReport } from '@shared/report/review'
import { copyText } from '../../components/clipboard'
import { engineLabel } from '../../engines/model'
import { EngineLogo } from '../../engines/EngineLogo'
import { createGridCsvExport } from '../../grid'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { closeDrawer, useDrawerStack } from '../../shell/drawers'
import { projectHash } from '../../shell/routes'
import { Drawer, ToolButton, UrlText } from '../../ui'
import { formatMoment } from '../../utils/dates'
import { ReportPage } from './copyCells'
import { CopyTool } from './toolParts'
import { DETAIL_DRAWER, DRILL_DRAWER, openReportDetail, siteDetail } from './drill'
import { drillCsvOf, drillView, questionDetailOf, type DrillView } from './drawerModel'
import { ResultTag } from './Figures'
import { DrawerQuestions } from './DrawerQuestions'
import { PageStoryBody } from './PageStoryBody'
import { storyOf } from './pageStoryModel'
import { PageTable } from './tables'

/** A site's own list of questions (not its "with you" or "gap" part). */
function isSiteList(id: string): boolean {
  return id.startsWith('dom:') && !id.endsWith(':with') && !id.endsWith(':gap')
}

/**
 * The ready report's drawers, over the screen (Docs/DRAWER.md): what a number counts
 * (`report-drill`), and one level down (`report-detail`): a question's answers on each
 * engine, the questions citing a site, or a page's questions.
 */
export function ReviewDrawers({
  report,
  metrics,
  projectId
}: {
  report: ReviewReport
  metrics: MetricsResult
  projectId: string
}): JSX.Element {
  const { stack } = useDrawerStack()
  return (
    <>
      {stack.map((entry, depth) => {
        if (entry.id === DRILL_DRAWER) {
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <DrillDrawer
                report={report}
                metrics={metrics}
                id={entry.params.rd ?? ''}
                depth={depth}
                projectId={projectId}
              />
            </DrawerLevel>
          )
        }
        if (entry.id === DETAIL_DRAWER) {
          return (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <DetailDrawer
                report={report}
                metrics={metrics}
                id={entry.params.rd2 ?? ''}
                depth={depth}
                projectId={projectId}
              />
            </DrawerLevel>
          )
        }
        return null
      })}
    </>
  )
}

function useCopyLink(projectId: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false)
  return {
    copied,
    copy: () => {
      void copyText(projectHash(projectId, window.location.hash)).then((ok) => {
        setCopied(ok)
        if (ok) window.setTimeout(() => setCopied(false), 1800)
      })
    }
  }
}

function Tools({ projectId, csv }: { projectId: string; csv: (() => void) | null }): JSX.Element {
  const link = useCopyLink(projectId)
  return (
    <div className="rv-dtools">
      {csv ? <ToolButton kind="csv" onClick={csv} /> : null}
      <CopyTool label="Copy link" link copied={link.copied} onClick={link.copy} />
    </div>
  )
}

function Stats({ stats }: { stats: DrillView['stats'] }): JSX.Element {
  return (
    <div className="rv-dstats" data-testid="rv-dstats">
      {stats.map((stat) => (
        <span key={stat.label}>
          <b className="num">{stat.value}</b> {stat.label}
        </span>
      ))}
    </div>
  )
}

function DrillDrawer({
  report,
  metrics,
  id,
  depth,
  projectId
}: {
  report: ReviewReport
  metrics: MetricsResult
  id: string
  depth: number
  projectId: string
}): JSX.Element {
  const view = drillView(report, id)
  const exportCsv = createGridCsvExport()
  return (
    <Drawer
      id={DRILL_DRAWER}
      title={view?.title ?? 'Not in this report'}
      subtitle={view?.sub ?? undefined}
      depth={depth}
      focusOnOpen="close"
      onClose={() => closeDrawer(depth)}
      attributes={{ 'data-rd': id }}
      className="rv-drawer"
    >
      {view === null ? (
        <p className="rv-muted">This list is not part of the report as it stands now.</p>
      ) : (
        <>
          <Tools
            projectId={projectId}
            csv={() => void exportCsv(drillCsvOf(report, view)).catch(() => undefined)}
          />
          {view.kind === 'questions' && view.outline ? <Outline lines={view.outline} /> : null}
          {view.kind === 'questions' ? (
            <DrawerQuestions
              key={id}
              report={report}
              metrics={metrics}
              rows={view.rows}
              label={view.title}
              withYou={isSiteList(id)}
            />
          ) : (
            <>
              <Stats stats={view.stats} />
              <PageTable
                rows={view.rows}
                fromLabel={report.fromLabel}
                toLabel={report.toLabel}
                label={view.title}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  )
}

function DetailDrawer({
  report,
  metrics,
  id,
  depth,
  projectId
}: {
  report: ReviewReport
  metrics: MetricsResult
  id: string
  depth: number
  projectId: string
}): JSX.Element {
  const at = id.indexOf(':')
  const kind = id.slice(0, at)
  const value = id.slice(at + 1)
  let title = 'Not in this report'
  let body: JSX.Element = (
    <p className="rv-muted">This item is not part of the report as it stands now.</p>
  )
  if (kind === 'q') {
    const detail = questionDetailOf(report, metrics, value)
    if (detail !== null) {
      title = detail.item.text
      body = <QuestionBody report={report} detail={detail} />
    }
  } else if (kind === 'site') {
    const view = drillView(report, `dom:${value}:a`)
    if (view !== null && view.kind === 'questions') {
      title = view.title
      body = (
        <>
          {view.sub ? <p className="rv-sub">{view.sub}</p> : null}
          <DrawerQuestions
            key={id}
            report={report}
            metrics={metrics}
            rows={view.rows}
            label={view.title}
            withYou
            tabKey="rdt2"
          />
        </>
      )
    }
  } else if (kind === 'page') {
    // Match the address loosely (trailing slash, www), as page cells link it.
    const url =
      report.pagesByUrl[value] !== undefined
        ? value
        : (Object.values(report.pagesByUrl).find((item) => pageKey(item.url) === pageKey(value))
            ?.url ?? value)
    const story = storyOf(report, metrics, url)
    if (story !== null) {
      title = story.page.title ?? story.page.path
      body = <PageStoryBody report={report} story={story} />
    }
  }
  return (
    <Drawer
      id={DETAIL_DRAWER}
      title={title}
      depth={depth}
      focusOnOpen="close"
      onClose={() => closeDrawer(depth)}
      attributes={{ 'data-rd2': id }}
      className="rv-drawer"
    >
      <Tools projectId={projectId} csv={null} />
      {body}
    </Drawer>
  )
}

function QuestionBody({
  report,
  detail
}: {
  report: ReviewReport
  detail: NonNullable<ReturnType<typeof questionDetailOf>>
}): JSX.Element {
  const { item } = detail
  const facts = [item.topic, item.funnel, item.intent, item.pageType].filter(Boolean).join(' · ')
  const end = (
    label: string,
    result: typeof item.now,
    page: string | null,
    position: number | null,
    named: boolean | null
  ): JSX.Element => (
    <div className="rv-panel rv-end" data-testid="rv-end">
      <h4>{label}</h4>
      <ResultTag result={result} />
      <div className="rv-muted rv-small">
        Cited through:{' '}
        {page === null ? (
          'no page of yours'
        ) : (
          <>
            <ReportPage url={page} /> (
            {result === 'target' ? 'the right page' : 'another page of yours'})
          </>
        )}
        {position === null ? '' : ` · source #${position}`}
      </div>
      <div className="rv-muted rv-small">
        Brand named: {named === null ? 'not checked' : named ? 'yes' : 'no'}
      </div>
    </div>
  )
  return (
    <>
      <div className="rv-dstats">
        <span>{facts}</span>
        {item.targets.length > 0 ? (
          <span>
            Target page:{' '}
            {item.targets[0] === undefined ? null : <ReportPage url={item.targets[0]} />}
            {item.targets.length > 1 ? ` (+${item.targets.length - 1} also OK)` : ''}
          </span>
        ) : null}
      </div>
      <div className="rv-grid2">
        {report.fromLabel !== null
          ? end(
              report.fromLabel,
              item.before,
              item.pageBefore,
              item.positionBefore,
              item.namedBefore
            )
          : null}
        {end(report.toLabel, item.now, item.pageNow, item.positionNow, item.namedNow)}
      </div>
      {detail.enginesNow.length > 0 ? (
        <section className="rv-panel">
          <h4>Each engine, {report.toLabel}</h4>
          <table className="rv-mini" aria-label="Each engine">
            <tbody>
              {detail.enginesNow.map((answer) => (
                <tr key={answer.engine}>
                  <td className="rv-logo">
                    <EngineLogo engine={answer.engine} size={18} />
                  </td>
                  <td>{engineLabel(answer.engine)}</td>
                  <td>
                    <ResultTag result={answer.result} />
                  </td>
                  <td className="rv-muted rv-path">
                    {answer.page === null ? '' : <ReportPage url={answer.page} />}
                    {answer.position === null ? '' : ` · #${answer.position}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section className="rv-panel">
        <h4>Other sites the answer cites</h4>
        <SiteLinks label={report.toLabel} sites={detail.sitesNow} />
        {report.fromLabel !== null ? (
          <SiteLinks label={report.fromLabel} sites={detail.sitesBefore} />
        ) : null}
      </section>
      {detail.history.length > 1 ? (
        <section className="rv-panel">
          <h4>Each check</h4>
          <table className="rv-mini" aria-label="Each check">
            <tbody>
              {detail.history.map((point) => (
                <tr key={point.at}>
                  <td>{formatMoment(point.at)}</td>
                  <td>
                    <ResultTag result={point.result} />
                  </td>
                  <td className="rv-muted">
                    {point.position === null ? '' : `source #${point.position}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  )
}

function SiteLinks({ label, sites }: { label: string; sites: readonly string[] }): JSX.Element {
  return (
    <p className="rv-sites">
      <span className="rv-muted">{label}: </span>
      {sites.length === 0 ? (
        <span className="rv-muted">none</span>
      ) : (
        sites.map((site, index) => (
          <span key={site}>
            {index > 0 ? ', ' : ''}
            <UrlText domain={site}>
              <button
                type="button"
                className="rv-link"
                onClick={() => openReportDetail(siteDetail(site))}
              >
                {site}
              </button>
            </UrlText>
          </span>
        ))
      )}
    </p>
  )
}

/** An answer journey's "Write a page in this order", with a copy button. */
function Outline({ lines }: { lines: readonly string[] }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <section className="rv-panel" data-testid="rv-outline">
      <div className="rv-panel-head">
        <h4>Write a page in this order</h4>
        <CopyTool
          label="Copy outline"
          copied={copied}
          onClick={() => {
            void copyText(lines.join('\n')).then((ok) => {
              setCopied(ok)
              if (ok) window.setTimeout(() => setCopied(false), 1800)
            })
          }}
        />
      </div>
      <ol className="rv-journey-outline">
        {lines.map((line) => (
          <li key={line}>{line.replace(/^\d+\.\s*/, '')}</li>
        ))}
      </ol>
    </section>
  )
}
