import { useMemo, useState, type JSX } from 'react'
import { isEngineId, type EngineId, type Market, type PageSummary } from '@shared/domain'
import type { MetricsRequest, ReportTable } from '@shared/ipc'
import {
  ONE_CHECK_KINDS,
  REPORT_TITLES,
  type ReportKind,
  type ReviewReport,
  type ReviewSectionId
} from '@shared/report/review'
import { LoadError } from '../../components/LoadError'
import { engineLabel } from '../../engines/model'
import { useEngineFilter } from '../../engines/useEngineFilter'
import { ENGINE_PARAM } from '../../engines/model'
import { marketLabel } from '../../shell/model'
import { useHashQuery } from '../../utils/hashQuery'
import { FilterBar, ToolButton, ToolGroup } from '../../ui'
import { formatMoment } from '../../utils/dates'
import type { ReviewClient } from './client'
import { DownloadMenu } from './DownloadMenu'
import { ReportSearch } from './ReportSearch'
import { ReportTabs } from './ReportTabs'
import { ReviewDrawers } from './ReviewDrawers'
import { ChangedSection, PublishedSection } from './sections/ListSections'
import { QuestionsSection } from './sections/QuestionsSection'
import { BacklinksSection, LostSection, NextSection } from './sections/AgencySections'
import { DeepSection } from './sections/DeepSection'
import { ChangedPagesPanel, CoverStrip, StructurePanel } from './sections/ChangedParts'
import { CompetitorsSection } from './sections/CompetitorsSection'
import { MethodSection, NotIndexedSection } from './sections/MoreSections'
import { ReputationSection } from './sections/ReputationSection'
import { ShapeSection } from './sections/ShapeSection'
import { SourcesSection } from './sections/SourcesSection'
import {
  VisPagesSection,
  VisStandingSection,
  VisTopicsSection
} from './sections/VisibilitySections'
import { VerdictSection } from './sections/VerdictSection'
import {
  H2hSection,
  PitchPlanSection,
  SummarySection,
  WritePlanSection
} from './sections/ReadySections'
import { EmptySection, NeedsPanel } from './sections/ImpactParts'
import { useReportDownload } from './useReportDownload'
import { useReviewData } from './useReviewData'
import { BylineLine } from '../branding/BrandingStrip'
import {
  checkOptions,
  lensOf,
  scopeOf,
  scopeValue,
  sectionOf,
  windowOf,
  SECTION_VALUES,
  type ReviewQuery
} from './urlState'

export interface ReviewProject {
  id: string
  name: string
  domain: string
  brand: string
  defaultMarket: Market | null
  markets: readonly Market[]
}

/**
 * One ready report in the app (Reports → Visibility report, What changed, Impact review):
 * the scope, From → To checks, market and engine pickers, the section tabs, and every
 * section. Every number opens a drawer over the screen; every pick is on the URL.
 */
export function ReviewView({
  kind,
  client,
  project,
  pages,
  query,
  setQuery,
  onHome,
  onSchedule
}: {
  kind: ReportKind
  client: ReviewClient
  project: ReviewProject
  pages: readonly Pick<PageSummary, 'id' | 'label' | 'title' | 'url' | 'kind'>[]
  query: ReviewQuery
  setQuery: (patch: ReviewQuery, options?: { replace?: boolean }) => void
  onHome: () => void
  onSchedule: () => void
}): JSX.Element {
  const scope = scopeOf(query)
  const win = windowOf(kind, query)
  const marketId = project.markets.some((market) => market.id === query.market)
    ? (query.market ?? null)
    : null
  // The engines on offer come with the numbers; the request reads the URL's engine as is.
  const [offered, setOffered] = useState<{ key: string; list: readonly EngineId[] }>({
    key: '',
    list: []
  })
  const engineState = useEngineFilter(offered.list)
  const [engineQuery] = useHashQuery(ENGINE_KEYS)
  const asked = engineQuery[ENGINE_PARAM]
  const engine: EngineId | 'all' = asked && isEngineId(asked) ? asked : 'all'
  const scopeKey = scopeValue(scope)
  // Hooks below key on the request's JSON, so a new object per render is fine.
  const request: MetricsRequest = {
    projectId: project.id,
    scope: scopeOf({ scope: scopeKey }),
    marketId,
    engine,
    from: win.from,
    to: win.to
  }
  const market =
    project.markets.find((item) => item.id === marketId) ?? project.defaultMarket ?? null
  const marketText = market ? marketLabel(market) : 'each page’s market'
  const scopePage = scope.kind === 'project' ? null : pages.find((page) => page.id === scope.id)
  const scopeLabel =
    scope.kind === 'project'
      ? 'Whole project'
      : `${scope.kind === 'topic' ? 'Topic' : 'Page'}: ${scopePage?.label ?? scopePage?.title ?? scopePage?.url ?? scope.id}`
  const rival = kind === 'rival' ? query.rival || undefined : undefined
  const ctx = {
    scopeLabel,
    ...(rival ? { rival } : {}),
    brand: project.brand,
    domain: project.domain,
    kind,
    day: dayLabel,
    marketLabel: marketText,
    engineLabel: engine === 'all' ? 'all engines' : engineLabel(engine)
  }
  const data = useReviewData(client, request, ctx)
  const offeredKey = data.metrics?.offeredEngines.join(',') ?? null
  // Kept across reloads, so the filter keeps its logos while new numbers load.
  if (offeredKey !== null && offeredKey !== offered.key) {
    setOffered({
      key: offeredKey,
      list: offeredKey === '' ? [] : (offeredKey.split(',') as EngineId[])
    })
  }
  const saving = useReportDownload(
    client,
    kind,
    kind === 'rival' && rival ? { ...request, rival } : request
  )
  const report = data.report
  const askedSection = sectionOf(kind, query)
  // What changed with one check shows one section; any other tab falls back to it.
  const section =
    report === null || report.sections.some((item) => item.id === askedSection)
      ? askedSection
      : (report.sections[0]?.id ?? askedSection)
  const options = useMemo(
    () => (data.metrics === null ? [] : checkOptions(data.metrics.checks, dayLabel)),
    [data.metrics]
  )

  return (
    <div className="rv" data-report={kind}>
      <nav className="rv-crumb" aria-label="Breadcrumb">
        <button type="button" className="rv-link" onClick={onHome}>
          Reports
        </button>{' '}
        / {REPORT_TITLES[kind]}
      </nav>
      <header className="rv-head">
        <div className="rv-head-top">
          <h2>{REPORT_TITLES[kind]}</h2>
          {report !== null && !ONE_CHECK_KINDS.has(kind) ? (
            <span className={`rv-badge rv-badge-${report.verdict.badge.tone}`}>
              {report.verdict.badge.label}
            </span>
          ) : null}
          {report !== null && kind !== 'changed' ? (
            <span className="rv-window" data-testid={kind === 'impact' ? 'rv-meta' : undefined}>
              {kind === 'impact'
                ? report.impact.intro.meta
                : `${report.windowLabel} · ${ctx.engineLabel}`}
              {data.metrics?.checks.at(-1)
                ? ` · last check ${formatMoment(data.metrics.checks.at(-1)?.at ?? null)}`
                : ''}
            </span>
          ) : null}
          <span className="rv-grow" />
          <ToolGroup label="Report tools">
            <DownloadMenu busy={saving.busy} onDownload={saving.download} />
            <ToolButton kind="print" onClick={() => saving.download('pdf')} />
            <ToolButton kind="schedule" onClick={onSchedule} />
          </ToolGroup>
        </div>
        <BylineLine branding={report?.branding} brand={project.brand} />
        <FilterBar
          label="Report filters"
          end={report !== null ? <ReportSearch report={report} /> : null}
        >
          <label className="ui-head-field">
            <span className="ui-head-field-label">Scope</span>
            <select
              className="select"
              value={scopeValue(scope) ?? ''}
              onChange={(event) => setQuery({ scope: event.target.value || null })}
            >
              <option value="">Whole project</option>
              {pages.map((page) => (
                <option
                  key={page.id}
                  value={`${page.kind === 'topic' ? 'topic' : 'page'}:${page.id}`}
                >
                  {page.kind === 'topic' ? 'Topic: ' : 'Page: '}
                  {page.label ?? page.title ?? page.url ?? page.id}
                </option>
              ))}
            </select>
          </label>
          {kind === 'rival' && report !== null && report.ready.rival.options.length > 0 ? (
            <label className="ui-head-field rv-rival-pick">
              <span className="ui-head-field-label">Rival</span>
              <select
                className="select"
                aria-label="Rival"
                value={report.ready.rival.domain ?? ''}
                onChange={(event) => setQuery({ rival: event.target.value || null })}
              >
                {report.ready.rival.options.map((domain) => (
                  <option key={domain} value={domain}>
                    vs {domain}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!ONE_CHECK_KINDS.has(kind) ? (
            <label className="ui-head-field">
              <span className="ui-head-field-label">From</span>
              <select
                className="select"
                value={query.from ?? ''}
                onChange={(event) => setQuery({ from: event.target.value || null })}
              >
                <option value="">From the first check</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    From {formatMoment(option.at)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="ui-head-field">
            <span className="ui-head-field-label">
              {ONE_CHECK_KINDS.has(kind) ? 'Check' : 'To'}
            </span>
            <select
              className="select"
              value={query.to ?? ''}
              onChange={(event) => setQuery({ to: event.target.value || null })}
            >
              <option value="">
                {ONE_CHECK_KINDS.has(kind) ? 'Latest check' : 'To the latest check'}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {ONE_CHECK_KINDS.has(kind)
                    ? `${formatMoment(option.at)} check`
                    : `To ${formatMoment(option.at)}`}
                </option>
              ))}
            </select>
          </label>
          {project.markets.length > 1 ? (
            <label className="ui-head-field">
              <span className="ui-head-field-label">Market</span>
              <select
                className="select"
                value={marketId ?? ''}
                onChange={(event) => setQuery({ market: event.target.value || null })}
              >
                <option value="">Each page’s market</option>
                {project.markets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {marketLabel(item)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="rv-fixed">{ctx.marketLabel}</span>
          )}
          <span className="rv-engines">{engineState.control}</span>
        </FilterBar>
        {report !== null && kind === 'changed' ? <CoverStrip report={report} /> : null}
        {saving.note ? (
          <p className={`rv-saved rv-saved-${saving.note.tone}`} role="status">
            {saving.note.text}
          </p>
        ) : null}
      </header>

      {data.problem ? (
        <LoadError title="This report could not load" message={data.problem} />
      ) : report === null ? (
        <p role="status" className="rv-muted">
          Loading the report…
        </p>
      ) : (
        <>
          {report.needs !== null ? <NeedsPanel needs={report.needs} /> : null}
          <ReportTabs
            kind={kind}
            sections={report.sections}
            section={section}
            onSection={(id) => setQuery({ ...SECTION_VALUES, section: id })}
          >
            {data.loading ? (
              <p role="status" className="rv-muted rv-loading">
                Updating…
              </p>
            ) : null}
            <SectionBody
              report={report}
              section={section}
              query={query}
              setQuery={setQuery}
              onCsv={(table) => saving.download('csv', table)}
            />
          </ReportTabs>
          {data.metrics !== null ? (
            <ReviewDrawers report={report} metrics={data.metrics} projectId={project.id} />
          ) : null}
        </>
      )}
    </div>
  )
}

const ENGINE_KEYS = [ENGINE_PARAM] as const

function dayLabel(iso: string): string {
  return formatMoment(iso)
}

function SectionBody({
  report,
  section,
  query,
  setQuery,
  onCsv
}: {
  report: ReviewReport
  section: string
  query: ReviewQuery
  setQuery: (patch: ReviewQuery, options?: { replace?: boolean }) => void
  onCsv: (table: ReportTable) => void
}): JSX.Element | null {
  const entry = report.sections.find((item) => item.id === section)
  if (entry === undefined && section !== 'verdict' && section !== 'standing') {
    return (
      <EmptySection
        title="Nothing here"
        line="Pick another tab: this one has nothing to show for these checks."
      />
    )
  }
  if (entry?.empty !== undefined) return <EmptySection title={entry.title} line={entry.empty} />
  const onSection = (id: ReviewSectionId): void => setQuery({ section: id })
  switch (section) {
    case 'standing':
      return (
        <VisStandingSection
          report={report}
          onWhatChanged={() => setQuery({ report: 'changed', section: null })}
          onReputation={() => setQuery({ section: 'reputation' })}
        />
      )
    case 'reputation':
      return <ReputationSection report={report} onCsv={onCsv} />
    case 'verdict':
      return <VerdictSection report={report} onSection={onSection} />
    case 'published':
      return (
        <div className="rv-stack">
          <PublishedSection
            report={report}
            chip={query.pshow ?? 'all'}
            onChip={(chip) => setQuery({ pshow: chip === 'all' ? null : chip })}
          />
          {report.kind === 'changed' ? <ChangedPagesPanel report={report} /> : null}
        </div>
      )
    case 'changed':
      return <ChangedSection report={report} />
    case 'questions':
      return (
        <QuestionsSection
          report={report}
          chip={query.show ?? 'all'}
          onChip={(chip) => setQuery({ show: chip === 'all' ? null : chip })}
          search={query.q ?? ''}
          onSearch={(value) => setQuery({ q: value || null }, { replace: true })}
          topic={query.qt ?? ''}
          onTopic={(value) => setQuery({ qt: value || null }, { replace: true })}
        />
      )
    case 'competitors':
      return (
        <CompetitorsSection
          report={report}
          kind={query.kind ?? 'all'}
          onKind={(kind) => setQuery({ kind: kind === 'all' ? null : kind }, { replace: true })}
          onCsv={onCsv}
        />
      )
    case 'pages':
      return <VisPagesSection report={report} onCsv={onCsv} />
    case 'topics':
      return (
        <VisTopicsSection
          report={report}
          lens={lensOf(query)}
          onLens={(lens) => setQuery({ seg: lens === 'topic' ? null : lens })}
        />
      )
    case 'notindexed':
      return <NotIndexedSection report={report} onCsv={() => onCsv('notindexed')} />
    case 'backlinks':
      return <BacklinksSection report={report} onCsv={() => onCsv('backlinks')} />
    case 'lost':
      return <LostSection report={report} />
    case 'deep':
      return report.kind === 'changed' ? (
        <div className="rv-stack">
          <StructurePanel report={report} />
          <DeepSection report={report} />
        </div>
      ) : (
        <DeepSection report={report} />
      )
    case 'sources':
      return <SourcesSection report={report} onCsv={onCsv} />
    case 'shape':
      return <ShapeSection report={report} />
    case 'next':
      return <NextSection report={report} onSection={onSection} />
    case 'method':
      return <MethodSection report={report} />
    case 'summary':
      return <SummarySection report={report} />
    case 'plan':
      return <PitchPlanSection report={report} />
    case 'writeplan':
      return <WritePlanSection report={report} onCsv={() => onCsv('contentplan')} />
    case 'h2h':
      return <H2hSection report={report} />
    default:
      return null
  }
}
