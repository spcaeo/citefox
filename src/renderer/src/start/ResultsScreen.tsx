import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SiteStartPlan, TopicResults } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { FoxMark } from '../components/Icon'
import { navigateHash, topicHash } from '../shell/routes'
import { formatDateTime } from '../topics/results/model/format'
import {
  Chip,
  KpiStrip,
  KpiTile,
  LinkButton,
  ListGrid,
  Panel,
  SectionHead,
  UrlText,
  type ListColumn
} from '../ui'
import { UiIcon } from '../ui/UiIcon'
import type { StartClient } from './client'
import { StartFooter, StartFrame } from './StartFrame'
import {
  firstResultsHeadline,
  firstResultsModel,
  pathOf,
  type FirstResultsFix,
  type FirstResultsModel
} from './resultsModel'
import './results.css'

type Loaded =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'empty'; plan: SiteStartPlan | null }
  | { kind: 'ready'; plan: SiteStartPlan; topicId: string; results: TopicResults }

/**
 * The first results moment (Mockups/v2/journey-a/A6-Results.png): what the first
 * check of the drafted topic found as one strip of four numbers, the first
 * three fixes as a list grid, the first win beside them, and every question
 * at a glance. Read from `topics:results` only; it spends nothing.
 */
export function StartResultsScreen({
  client,
  project
}: {
  client: StartClient
  project: { id: string; name: string; domain: string }
}): JSX.Element {
  const [state, setState] = useState<Loaded>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const plan = await client.get({ projectId: project.id })
        const topicId = plan?.topicId ?? null
        if (plan === null || topicId === null) {
          if (!cancelled) setState({ kind: 'empty', plan })
          return
        }
        const results = await client.topicResults({
          projectId: project.id,
          topicId,
          marketId: null,
          runId: null
        })
        if (!cancelled) setState({ kind: 'ready', plan, topicId, results })
      } catch (cause) {
        if (!cancelled)
          setState({ kind: 'failed', message: errorText(cause, 'Could not load results.') })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, project.id])

  const plan = state.kind === 'ready' || state.kind === 'empty' ? state.plan : null
  const searchesLeft = plan?.budget.searchesLeft ?? null

  if (state.kind !== 'ready') {
    return (
      <StartFrame
        step="results"
        projectName={project.name}
        domain={project.domain}
        searchesLeft={searchesLeft}
        title={state.kind === 'empty' ? 'No first check yet' : 'Your first results'}
        subtitle={
          state.kind === 'loading' ? (
            <span role="status">Loading results…</span>
          ) : state.kind === 'failed' ? (
            state.message
          ) : (
            'Start the first check from your plan, and the results open here.'
          )
        }
        footer={
          <StartFooter>
            <LinkButton variant="primary" href="#/start" iconEnd="arrow-right">
              Go to your plan
            </LinkButton>
          </StartFooter>
        }
      >
        <span />
      </StartFrame>
    )
  }

  const model = firstResultsModel(state.results)
  const dashboard = topicHash(state.topicId)
  const checkedAt = state.results.topic.checkedAt
  const site = `https://${project.domain}`
  return (
    <StartFrame
      step="results"
      projectName={project.name}
      domain={project.domain}
      searchesLeft={searchesLeft}
      lead={
        <span className="fr-lead" aria-hidden="true">
          <FoxMark />
        </span>
      }
      title={
        <>
          <span className="fr-done">
            <UiIcon name="check" size={14} />
            First check done · {model.checked} of {model.questions} questions checked
            {checkedAt ? ` · ${formatDateTime(checkedAt)}` : ''}
          </span>
          <span className="fr-headline">{firstResultsHeadline(model)}</span>
        </>
      }
      subtitle={subtitleFor(model)}
      footer={
        <StartFooter note="Saved to your dashboard · share it as a report any time">
          <LinkButton variant="primary" href={dashboard} iconEnd="arrow-right">
            Open my dashboard
          </LinkButton>
        </StartFooter>
      }
    >
      <Kpis model={model} />
      <div className="ui-layout-main-rail">
        <div className="sf-col">
          <Fixes
            model={model}
            topicId={state.topicId}
            site={site}
            intervalDays={state.results.topic.intervalDays}
          />
          <Glance model={model} />
        </div>
        <WinPanel model={model} />
      </div>
    </StartFrame>
  )
}

function subtitleFor(model: FirstResultsModel): string {
  if (model.withAio === 0)
    return 'No AI Overview showed this time. Overviews come and go; the next check looks again.'
  if (model.cited === 0) return 'Here is the closest miss and your first 3 fixes.'
  return `Here's your first win and your first ${Math.min(3, model.fixes.length) || 3} fixes.`
}

/** The four headline numbers on one row. */
function Kpis({ model }: { model: FirstResultsModel }): JSX.Element {
  const shownPct = model.checked === 0 ? 0 : Math.round((model.withAio / model.checked) * 100)
  return (
    <KpiStrip label="First check numbers" className="sf-kpis">
      <KpiTile
        label="AI Overview shown"
        value={model.withAio}
        suffix={`/ ${model.checked}`}
        sub={`${shownPct}% of the questions checked`}
      />
      <KpiTile
        label="You’re cited"
        value={model.cited}
        suffix={`of ${model.withAio}`}
        goal={{ value: model.rate ?? 0, valueLabel: `${model.rate ?? 0}% cited` }}
        sub={model.rate === null ? 'No overview to cite you yet' : `${model.rate}% of overviews`}
      />
      <KpiTile
        label="Cited most instead"
        value={model.topInstead ? model.topInstead.domain : '—'}
        suffix={model.topInstead ? String(model.topInstead.count) : undefined}
        sub={
          model.topInstead
            ? model.nextInstead.length > 0
              ? model.nextInstead.map((item) => `${item.domain} ${item.count}`).join(' · ')
              : 'No other site cited'
            : 'No other site cited yet'
        }
        className="fr-name-tile"
      />
      <KpiTile
        label={
          model.targetPages === 0
            ? 'Target pages'
            : `Your ${model.targetPages} target ${model.targetPages === 1 ? 'page' : 'pages'}`
        }
        value={model.targetPagesCited}
        suffix="cited"
        sub={
          model.targetPages === 0
            ? 'No question points at a page yet'
            : model.targetPagesCited === model.targetPages
              ? 'Every target page is cited'
              : 'That is what the fixes are for'
        }
      />
    </KpiStrip>
  )
}

/** The topic's to-do, filtered to the fix's match state. */
function fixHref(topicId: string, fix: FirstResultsFix): string {
  return topicHash(topicId, { filter: `state:${fix.state}` })
}

interface FixRow {
  fix: FirstResultsFix
  rank: number
}

function Fixes({
  model,
  topicId,
  site,
  intervalDays
}: {
  model: FirstResultsModel
  topicId: string
  site: string
  intervalDays: number
}): JSX.Element {
  const rows: FixRow[] = model.fixes.map((fix, index) => ({ fix, rank: index + 1 }))
  const hrefOf = (row: FixRow): string => fixHref(topicId, row.fix)
  const columns = useMemo<ListColumn<FixRow>[]>(
    () => [
      {
        id: 'rank',
        label: 'Rank',
        hideLabel: true,
        width: 48,
        numeric: true,
        render: (row) => row.rank
      },
      {
        id: 'fix',
        label: 'Fix',
        width: 'fill',
        minWidth: 220,
        render: (row) => (
          <span className="fr-fix">
            <a className="fr-fix-title" href={fixHref(topicId, row.fix)}>
              {row.fix.title}
            </a>
            <span className="fr-fix-detail" title={row.fix.detail}>
              {row.fix.detail}
            </span>
          </span>
        )
      },
      {
        id: 'target',
        label: 'Target page',
        width: 190,
        render: (row) =>
          row.fix.target ? (
            <UrlText url={row.fix.target} site={site} />
          ) : (
            <span className="sf-faint">No page yet</span>
          )
      },
      {
        id: 'state',
        label: 'Moves',
        width: 116,
        render: (row) =>
          row.fix.state === 'no_page' ? (
            <Chip size="sm" tone="info">
              New page
            </Chip>
          ) : (
            <Chip size="sm" tone="warn">
              {row.fix.chip}
            </Chip>
          )
      }
    ],
    [topicId, site]
  )
  return (
    <section className="sf-section" aria-labelledby="fr-fix-title">
      <SectionHead
        id="fr-fix-title"
        title={`Your first ${model.fixes.length || 3} fixes`}
        description="Ranked by how many questions they move"
        actions={
          <LinkButton size="sm" variant="text" href={topicHash(topicId)}>
            See all {model.questions} answers
          </LinkButton>
        }
      />
      <ListGrid
        label="Your first fixes"
        noun={['fix', 'fixes']}
        rows={rows}
        rowKey={(row) => row.fix.key}
        rowLabel={(row) => row.fix.title}
        columns={columns}
        onActivate={(row) => navigateHash(hrefOf(row))}
        summary={() =>
          intervalDays === 1 ? 'Next check tomorrow' : `Next check in ${intervalDays} days`
        }
        empty={
          <p className="fr-empty sf-faint">
            Nothing to fix: every question with an overview cites you.
          </p>
        }
      />
    </section>
  )
}

/** Every question's top cited source, as small cells. */
function Glance({ model }: { model: FirstResultsModel }): JSX.Element {
  return (
    <Panel
      title={`All ${model.questions} questions at a glance`}
      titleAs="h2"
      padding={20}
      actions={<span className="sf-faint fr-glance-note">Top source cited</span>}
    >
      <ul className="fr-glance-grid" aria-label="Top source cited for each question">
        {model.glance.map((cell) => (
          <li
            key={cell.promptId}
            className={cell.own ? 'fr-cell fr-cell-own' : 'fr-cell'}
            aria-label={`Q${cell.number}: ${cell.own ? 'you are cited' : cell.noAio ? 'no AI Overview' : cell.label}`}
          >
            <span className="fr-cell-top">
              <span className="num">Q{cell.number}</span>
              {cell.noAio ? <span className="sf-faint">no AI Overview</span> : null}
            </span>
            <span className="fr-cell-label">{cell.label}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function WinPanel({ model }: { model: FirstResultsModel }): JSX.Element {
  const win = model.win
  return (
    <Panel
      title={win?.cited === false ? 'Your closest miss' : 'Your first win'}
      titleAs="h2"
      padding={20}
      actions={
        win ? (
          <Chip size="sm" tone={win.cited ? 'fox' : 'neutral'}>
            {win.cited
              ? `Cited${win.row.position === null ? '' : ` · source #${win.row.position}`}`
              : 'Overview shown, not cited'}
          </Chip>
        ) : null
      }
    >
      {win === null ? (
        <p className="fr-text sf-faint">
          No overview cited anyone for these questions yet. The next check looks again.
        </p>
      ) : (
        <>
          <p className="fr-quote">&ldquo;{win.row.text}&rdquo;</p>
          {win.sources.length > 0 ? (
            <div className="fr-sources">
              <p className="fr-sources-head">
                <UiIcon name="sparkle" size={14} />
                AI Overview sources · Q{win.row.number}
              </p>
              <ol aria-label={`AI Overview sources for Q${win.row.number}`}>
                {win.sources.map((source) => (
                  <li key={source.position} className={source.own ? 'fr-own' : undefined}>
                    <span className="num sf-faint">{source.position}</span>
                    <span className={source.own ? 'sf-mono' : undefined}>{source.label}</span>
                    {source.own ? <span className="sr-only"> (your page)</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {win.row.aioSummary ? (
            <blockquote className="fr-aio">
              <p>&ldquo;{win.row.aioSummary}&rdquo;</p>
              {win.row.checkedAt ? (
                <footer className="sf-faint">
                  From the AI Overview, {formatDateTime(win.row.checkedAt)}
                </footer>
              ) : null}
            </blockquote>
          ) : null}
          {!win.cited ? (
            <p className="fr-text">
              {win.row.targetUrl
                ? `${pathOf(win.row.targetUrl)} exists but is not cited for this question yet.`
                : 'No page of yours answers this question yet.'}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}
