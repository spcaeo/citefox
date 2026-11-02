import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { TopicResultRow } from '@shared/domain'
import type { TopicResults } from '@shared/ipc'
import { clockText } from '@shared/site-start'
import { errorText } from '../components/errorText'
import { navigateHash, startHash, topicHash } from '../shell/routes'
import {
  Button,
  Chip,
  DomainText,
  KpiStrip,
  KpiTile,
  ListGrid,
  Panel,
  SectionHead,
  UrlText,
  type ListColumn
} from '../ui'
import type { StartClient } from './client'
import { OPEN_RESULTS_AFTER_MS, soFar } from './model'
import { ShareBar, StartClock, StartFooter, StartFrame } from './StartFrame'
import type { StartProject } from './types'
import './check.css'

const POLL_MS = 1500

const COLUMNS: readonly ListColumn<TopicResultRow>[] = [
  {
    id: 'q',
    label: 'Q',
    width: 56,
    render: (row) => <span className="sf-faint num">Q{row.number}</span>
  },
  {
    id: 'question',
    label: 'Buyer question',
    width: 'fill',
    minWidth: 220,
    render: (row) => (
      <span className="ck-text" title={row.text}>
        {row.text}
      </span>
    )
  },
  {
    id: 'overview',
    label: 'AI Overview',
    width: 112,
    render: (row) => <OverviewChip row={row} />
  },
  {
    id: 'cited',
    label: 'Cited in the overview',
    width: 220,
    render: (row) =>
      row.citedOwnUrl !== null ? (
        <span className="ck-you-row">
          <Chip size="sm" tone="fox" className="ck-you">
            You
          </Chip>
          <UrlText url={row.citedOwnUrl} label={pathOf(row.citedOwnUrl)} own />
        </span>
      ) : row.state === 'no_aio' ? (
        <span className="sf-faint">No overview on this one</span>
      ) : row.state === 'not_checked' ? (
        <span className="ck-skeleton" aria-hidden="true" />
      ) : (
        <span className="ck-cited ck-cited-sites">
          {row.citedInstead.length === 0
            ? '—'
            : row.citedInstead
                .slice(0, 2)
                .map((domain) => <DomainText key={domain} domain={domain} plain />)}
        </span>
      )
  }
]

/**
 * "Asking Google N questions" (Mockups/v2/journey-a A5): the numbers so far as
 * one KPI strip, each question's AI Overview and who it cites as answers land
 * (a list grid), who the overviews cite on the right, with the clock and
 * Cancel. The first results open on their own when the last answer is in.
 */
export function CheckScreen({
  client,
  project
}: {
  client: StartClient
  project: StartProject
}): JSX.Element {
  const [topicId, setTopicId] = useState<string | null>(null)
  const [results, setResults] = useState<TopicResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number>(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [cancelled, setCancelled] = useState(false)
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null)

  useEffect(() => {
    let stop = false
    client.get({ projectId: project.id }).then(
      (plan) => {
        if (stop) return
        if (plan === null) navigateHash(startHash('setup'))
        else if (plan.topicId === null) navigateHash(startHash('plan'))
        else {
          setTopicId(plan.topicId)
          setSearchesLeft(plan.budget.searchesLeft)
          if (plan.firstCheckAt) setStartedAt(Date.parse(plan.firstCheckAt))
        }
      },
      (cause: unknown) => {
        if (!stop) setError(errorText(cause, 'Could not load the check.'))
      }
    )
    return () => {
      stop = true
    }
  }, [client, project.id])

  const refresh = useCallback(() => {
    if (topicId === null) return
    void client
      .topicResults({ projectId: project.id, topicId, marketId: null, runId: null })
      .then(setResults, (cause: unknown) =>
        setError(errorText(cause, 'Could not read the answers yet.'))
      )
  }, [client, project.id, topicId])

  const counts = useMemo(() => soFar(results?.rows ?? []), [results])
  const done = counts.total > 0 && counts.checked >= counts.total

  useEffect(() => {
    if (topicId === null || done || cancelled) return
    refresh()
    const timer = window.setInterval(() => {
      refresh()
      setNow(Date.now())
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [topicId, done, cancelled, refresh])

  useEffect(
    () =>
      client.onCheckFinished((notice) => {
        if (notice.pageId === topicId) refresh()
      }),
    [client, topicId, refresh]
  )

  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => navigateHash(startHash('results')), OPEN_RESULTS_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [done])

  async function cancel(): Promise<void> {
    const jobs = await client.activeJobs({ projectId: project.id })
    await Promise.all(
      jobs
        .filter((job) => topicId !== null && job.pageIds.includes(topicId))
        .map((job) => client.cancelJob({ jobId: job.id }))
    )
    setCancelled(true)
  }

  const questions = (results?.rows ?? []).filter((row) => row.kind === 'question')
  const ordered = [
    ...questions.filter((row) => row.state !== 'not_checked'),
    ...questions.filter((row) => row.state === 'not_checked')
  ]
  const share = counts.total === 0 ? 0 : Math.round((counts.checked / counts.total) * 100)
  const left = counts.total - counts.checked
  const rate = counts.shown === 0 ? null : Math.round((counts.cited / counts.shown) * 100)
  const rivals = counts.domains.filter((entry) => !entry.own)
  const top = rivals[0]

  return (
    <StartFrame
      step="check"
      projectName={project.name}
      domain={project.domain}
      searchesLeft={searchesLeft}
      title={`Asking Google ${counts.total > 0 ? counts.total : ''} questions`.replace('  ', ' ')}
      subtitle="Live from google.com. Each answer lands here as it comes in."
      aside={
        <>
          <StartClock
            clock={clockText(now - startedAt)}
            note={
              done
                ? 'done'
                : `${counts.checked} of ${counts.total}${left > 0 ? ` · about ${left * 4} s left` : ''}`
            }
          />
          <Button
            variant="ghost"
            disabled={done || cancelled || topicId === null}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        </>
      }
      footer={
        <StartFooter
          onBack={() => navigateHash(startHash('plan'))}
          note={
            cancelled
              ? 'Cancelled · answers so far are saved'
              : done
                ? 'All answers are in · results open now'
                : `${counts.checked} of ${counts.total} answers in · results open here when done`
          }
        >
          {cancelled && !done ? (
            <Button
              variant="primary"
              icon="arrow-right"
              onClick={() => navigateHash(topicId ? topicHash(topicId) : startHash())}
            >
              Open the topic
            </Button>
          ) : (
            <Button
              variant="primary"
              icon="arrow-right"
              disabled={!done}
              onClick={() => navigateHash(startHash('results'))}
            >
              See first results
            </Button>
          )}
        </StartFooter>
      }
    >
      {error ? (
        <p className="sf-error" role="alert">
          {error}
        </p>
      ) : null}
      <KpiStrip label="So far" className="sf-kpis">
        <KpiTile
          label="Answers in"
          value={counts.checked}
          suffix={`/ ${counts.total}`}
          sub={done ? 'All answers are in' : 'Each answer is saved the moment it lands'}
        />
        <KpiTile
          label="AI Overview shown"
          value={counts.shown}
          suffix={`of ${counts.checked}`}
          sub="Questions with an overview so far"
        />
        <KpiTile
          label="You’re cited"
          value={counts.cited}
          suffix={`of ${counts.shown}`}
          {...(rate === null ? {} : { goal: { value: rate, valueLabel: `${rate}% cited` } })}
          sub={rate === null ? 'Waiting for the first overview' : `${rate}% of overviews`}
        />
        <KpiTile
          label="Cited most instead"
          value={top ? top.domain : '—'}
          suffix={top ? String(top.count) : undefined}
          sub={
            rivals.length > 1
              ? rivals
                  .slice(1)
                  .map((entry) => `${entry.domain} ${entry.count}`)
                  .join(' · ')
              : 'Updates live'
          }
          className="ck-kpi-name"
        />
      </KpiStrip>
      <div className="ui-layout-main-rail">
        <section className="sf-section" aria-labelledby="ck-questions">
          <SectionHead
            id="ck-questions"
            title="Questions"
            actions={
              <span className="ck-live">
                <Chip size="sm" tone={done ? 'ok' : 'info'} dot={!done}>
                  {done ? 'Done' : 'Live'}
                </Chip>
                <span
                  className="ck-bar"
                  role="progressbar"
                  aria-label="Questions checked"
                  aria-valuemin={0}
                  aria-valuemax={counts.total}
                  aria-valuenow={counts.checked}
                >
                  <ShareBar percent={share} />
                </span>
                <span className="sf-faint num">
                  {counts.checked} of {counts.total}
                </span>
              </span>
            }
          />
          <ListGrid
            label="Questions"
            noun={['question', 'questions']}
            rows={ordered}
            rowKey={(row) => row.promptId}
            rowLabel={(row) => `Q${row.number}`}
            columns={COLUMNS}
            pageSize="all"
            summary={() => `Answers in: ${counts.checked} of ${counts.total}`}
            empty={<p className="ck-empty sf-faint">Starting the check…</p>}
          />
        </section>
        <Panel
          title="Cited in overviews"
          padding={20}
          actions={<span className="sf-faint ck-note">updates live</span>}
        >
          <ul className="ck-domains">
            {counts.domains.map((entry) => (
              <li key={entry.own ? 'own' : entry.domain} className={entry.own ? 'ck-own' : ''}>
                <DomainText
                  domain={entry.own ? project.domain : entry.domain}
                  {...(entry.own ? { own: true, kind: 'you' } : {})}
                />
                <ShareBar
                  percent={(entry.count / Math.max(1, counts.shown)) * 100}
                  tone={entry.own ? 'fox' : 'spruce'}
                />
                <span className="num">{entry.count}</span>
              </li>
            ))}
            {counts.domains.length === 0 ? (
              <li className="sf-faint">Waiting for the first overview…</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </StartFrame>
  )
}

function OverviewChip({ row }: { row: TopicResultRow }): JSX.Element {
  if (row.state === 'not_checked') return <span className="sf-faint">Queued</span>
  if (row.state === 'failed')
    return (
      <Chip size="sm" tone="warn">
        Failed
      </Chip>
    )
  if (row.state === 'no_aio') return <Chip size="sm">None</Chip>
  return (
    <Chip size="sm" tone="ok">
      Shown
    </Chip>
  )
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
