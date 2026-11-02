import { useCallback, useEffect, useId, useState, type JSX } from 'react'
import { fixKindLabel } from '@shared/domain'
import type { LostBucket, LostGroundView } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { checkScope, drillCell } from '../changes/drills'
import { errorText } from '../components/errorText'
import { LoadError } from '../components/LoadError'
import { DrillNumber, useDrill, type PromptDrill } from '../drill'
import { pathOf } from '../fixes/model'
import type { ProjectFixesSource } from '../fixes/source'
import { useEngineRevision } from '../shell/engineRevision'
import { Button, KpiStrip, KpiTile, ListGrid, UrlText, type ListColumn } from '../ui'
import { formatMoment, formatWhen } from '../utils/dates'
import { bucketRows, citedBefore, LOST_BUCKETS, stageRows, type StageRow } from './model'
import { OutlinePanel } from './OutlinePanel'
import { RecoveryPlan } from './RecoveryPlan'
import './lostGround.css'

const BUCKET_COPY: Record<LostBucket, string> = {
  still_cited: 'Questions that cited this page before and still do.',
  moved_tracked: 'Google now cites another page you track for these questions.',
  moved_own: 'Google now cites another page on your site, one you do not track.',
  not_cited: 'Google cites none of your pages for these questions now.'
}

/**
 * Lost ground (`?view=lost&lost=<pageId>&vs=<runId>`): where the questions that cited
 * a page went between two full checks, how the page's outline changed, the lost
 * questions by stage, and an editable recovery plan.
 */
export function LostGround({
  projectId,
  pageId,
  vsRunId,
  editing,
  client,
  assistClient,
  onVs,
  onEdit,
  onBack
}: {
  projectId: string
  pageId: string
  vsRunId: string | null
  editing: boolean
  client: ProjectFixesSource
  assistClient?: AssistClient
  onVs: (runId: string | null) => void
  onEdit: (editing: boolean) => void
  onBack: () => void
}): JSX.Element {
  const revision = useEngineRevision()
  const [view, setView] = useState<LostGroundView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const reload = useCallback(() => setReloads((value) => value + 1), [])

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => client['fixes:lostGround']({ projectId, pageId, vsRunId }))
      .then(
        (next) => {
          if (!live) return
          setView(next)
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load what happened to this page.'))
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, pageId, vsRunId, revision, reloads])

  const back = (
    <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>
      Back to changes
    </Button>
  )
  if (error && view === null) {
    return (
      <div className="fxp-view lg-view">
        {back}
        <LoadError title="Could not load lost ground." message={error} onRetry={reload} />
      </div>
    )
  }
  if (view === null) {
    return (
      <div className="fxp-view lg-view">
        {back}
        <p role="status" className="muted">
          Loading what happened…
        </p>
      </div>
    )
  }
  return (
    <div className="fxp-view lg-view">
      {back}
      <LostBody
        view={view}
        projectId={projectId}
        editing={editing}
        {...(assistClient ? { assistClient } : {})}
        onVs={onVs}
        onEdit={onEdit}
        onSave={async (text, inputKey) => {
          const plan = await client['fixes:saveRecoveryPlan']({ projectId, pageId, inputKey, text })
          reload()
          return plan
        }}
        onAnswer={reload}
      />
    </div>
  )
}

function LostBody({
  view,
  projectId,
  editing,
  assistClient,
  onVs,
  onEdit,
  onSave,
  onAnswer
}: {
  view: LostGroundView
  projectId: string
  editing: boolean
  assistClient?: AssistClient
  onVs: (runId: string | null) => void
  onEdit: (editing: boolean) => void
  onSave: Parameters<typeof RecoveryPlan>[0]['onSave']
  onAnswer: () => void
}): JSX.Element {
  const selectId = useId()
  const { open } = useDrill()
  const context = { markets: [], brand: '', domain: domainOf(view.url) }
  const beforeScope = checkScope(context, view.pageId, view.before)
  const nowScope = checkScope(context, view.pageId, view.now)
  const path = pathOf(view.url)
  const leadDrill: PromptDrill = {
    kind: 'prompts',
    id: 'lost:before',
    title: `Cited this page on ${formatMoment(view.before.checkedAt)}`,
    description: `Questions that cited ${path} in the older check.`,
    rows: citedBefore(view),
    scope: beforeScope
  }
  const bucketDrill = (bucket: LostBucket, label: string): PromptDrill => ({
    kind: 'prompts',
    id: `lost:${bucket}`,
    title: label,
    description: `${BUCKET_COPY[bucket]} As they stand on ${formatMoment(view.now.checkedAt)}.`,
    rows: bucketRows(view, bucket),
    scope: nowScope
  })
  const stageDrill = (row: StageRow, which: 'lost' | 'before'): PromptDrill => ({
    kind: 'prompts',
    id: `lost:stage:${row.stage}:${which}`,
    title: which === 'lost' ? `Lost · ${row.label}` : `Cited before · ${row.label}`,
    description:
      which === 'lost'
        ? 'Questions of this stage that no longer cite this page.'
        : 'Questions of this stage that cited this page in the older check.',
    rows: which === 'lost' ? row.lost : row.before,
    scope: which === 'lost' ? nowScope : beforeScope
  })
  const stageColumns: readonly ListColumn<StageRow>[] = [
    { id: 'stage', label: 'Stage', width: 'fill', minWidth: 140, render: (row) => row.label },
    {
      id: 'lost',
      label: 'Lost',
      width: 88,
      numeric: true,
      sort: (row) => row.lost.length,
      render: (row) => row.lost.length,
      drill: (row) => drillCell(open, stageDrill(row, 'lost'))
    },
    {
      id: 'before',
      label: 'Cited before',
      width: 112,
      numeric: true,
      sort: (row) => row.before.length,
      render: (row) => row.before.length,
      drill: (row) => drillCell(open, stageDrill(row, 'before'))
    }
  ]
  const older = view.checks.filter((item) => item.runId !== view.now.runId)
  useAiContext({
    pageId: view.pageId,
    runId: view.now.runId,
    entities: [{ kind: 'page', id: view.pageId, label: view.title ?? path }],
    numbers: [
      { label: 'Cited before', value: String(citedBefore(view).length), drill: leadDrill.id },
      ...LOST_BUCKETS.map((bucket) => ({
        label: bucket.label,
        value: String(bucketRows(view, bucket.id).length),
        drill: `lost:${bucket.id}`
      }))
    ],
    facts: [
      `Compared ${formatMoment(view.before.checkedAt)} with ${formatMoment(view.now.checkedAt)}`,
      ...(view.change
        ? [`${fixKindLabel(view.change.kind)} live ${formatWhen(view.change.liveSince)}`]
        : [])
    ]
  })

  return (
    <>
      <div className="lg-head">
        <div className="lg-head-text">
          <h2 className="lg-title">{view.title ?? path}: what happened</h2>
          <p className="lg-meta">
            <UrlText url={view.url} label={path} site={domainOf(view.url)} />
            {view.change ? (
              <span className="muted">
                {fixKindLabel(view.change.kind)} and live since {formatWhen(view.change.liveSince)}
              </span>
            ) : null}
          </p>
        </div>
        {older.length > 0 ? (
          <label className="lg-compare" htmlFor={selectId}>
            <span>Compare with</span>
            <select
              id={selectId}
              className="select"
              value={view.before.runId}
              onChange={(event) => onVs(event.target.value)}
            >
              {older.map((item) => (
                <option key={item.runId} value={item.runId}>
                  {formatMoment(item.checkedAt)} · {pluralize(item.cited, 'question')} cited
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="lg-lead">
        <DrillNumber
          drill={leadDrill}
          label={`${leadDrill.rows.length} questions cited this page`}
        />{' '}
        {leadDrill.rows.length === 1 ? 'question' : 'questions'} cited this page on{' '}
        {formatMoment(view.before.checkedAt)}. On {formatMoment(view.now.checkedAt)}:
      </p>
      <KpiStrip label="Where the questions went">
        {LOST_BUCKETS.map((bucket) => (
          <KpiTile
            key={bucket.id}
            label={bucket.label}
            className={bucket.id === 'not_cited' ? 'lg-kpi-bad' : undefined}
            value={<DrillNumber drill={bucketDrill(bucket.id, bucket.label)} />}
          />
        ))}
      </KpiStrip>
      {view.notCheckedNow.length > 0 ? (
        <p className="faint">
          {pluralize(view.notCheckedNow.length, 'question')} that cited it before{' '}
          {view.notCheckedNow.length === 1 ? 'is' : 'are'} not in the latest check (the question set
          changed), so {view.notCheckedNow.length === 1 ? 'it is' : 'they are'} left out.
        </p>
      ) : null}
      <OutlinePanel view={view} />
      <div className="ui-cols-2 lg-pair">
        <div className="lg-stages">
          <h2 className="lg-section-title">Lost questions by stage</h2>
          <ListGrid<StageRow>
            label="Lost questions by stage"
            noun={['stage', 'stages']}
            rows={stageRows(view)}
            rowKey={(row) => row.stage}
            rowLabel={(row) => row.label}
            columns={stageColumns}
            pageSize="all"
            empty={<p className="muted lg-empty">No questions lost between these two checks.</p>}
          />
        </div>
        <RecoveryPlan
          view={view}
          projectId={projectId}
          editing={editing}
          {...(assistClient ? { assistClient } : {})}
          onEdit={onEdit}
          onSave={onSave}
          onAnswer={onAnswer}
        />
      </div>
    </>
  )
}

/** The page's host, for copy and open on its path. */
function domainOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
