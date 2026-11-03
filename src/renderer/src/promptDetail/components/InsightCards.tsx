import { urlPath } from '../../topics/results/model/scoring'
import type { JSX } from 'react'
import type { AioGapFact, AioReference, PromptCheckRow, SampleCapture } from '@shared/domain'
import { LoadError } from '../../components/LoadError'
import { Markdown } from '../../components/Markdown'
import { StatusChip } from '../../m3/bits'
import { coverageLabel } from '../../m3/model'
import { planFixHash } from '../../progress/model'
import { navigateHash, pageHash, promptHash, readHash, sectionHash } from '../../shell/routes'
import { formatMoment } from '../../utils/dates'
import { Chip, EmptyState, LinkButton, ListGrid, type ListColumn, type MenuItem } from '../../ui'
import type { PromptTimeRow } from '../types'
import { contentLabel, sourceFor } from '../utils/model'
import { Card } from './OverviewCards'

/** FR-13.4: stored `aio_gap.md` facts for this prompt and run. */
export function GapCard({
  pageId,
  gaps,
  references = [],
  onSource
}: {
  pageId: string
  gaps: readonly AioGapFact[] | null
  /** The overview's sources, so "likely from" can point at its line. */
  references?: readonly AioReference[]
  /** Moves to a source line by position. */
  onSource: (position: number) => void
}): JSX.Element {
  return (
    <Card
      headingId="pd-gap-h"
      title="What the overview says that your page doesn't"
      aside={gaps && gaps.length > 0 ? <Chip size="sm">Written by CiteFox AI</Chip> : undefined}
    >
      {gaps === null ? (
        <p className="pd2-muted">
          No comparison is stored for this question in this check. Content gaps compares every
          question with the page.
        </p>
      ) : gaps.length === 0 ? (
        <p className="pd2-muted">The overview says nothing the page doesn&apos;t already cover.</p>
      ) : (
        <ul className="pd2-list">
          {gaps.map((gap, index) => (
            <li key={`${index}-${gap.fact}`}>
              <Markdown inline baseLevel={3}>
                {gap.fact}
              </Markdown>
              {gap.likelySource ? (
                <LikelySource
                  references={references}
                  likely={gap.likelySource}
                  onSource={onSource}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="pd2-faint">
        <a href={pageHash(pageId, 'gaps')}>Open Content gaps</a> for the matrix and one-by-one
        fixes.
      </p>
    </Card>
  )
}

/** FR-13.4: page coverage from the latest gap row, with the places it was found. */
export function CoverageCard({
  pageId,
  row,
  whereCovered
}: {
  pageId: string
  row: PromptCheckRow | null
  whereCovered: readonly string[]
}): JSX.Element {
  const level = row?.coverage ?? null
  return (
    <Card
      headingId="pd-cov-h"
      title={`Page coverage: ${level ? coverageLabel(level) : 'not rated yet'}`}
    >
      {whereCovered.length > 0 ? (
        <ul className="pd2-list" aria-label="Where the page covers this question">
          {whereCovered.map((place, index) => (
            <li key={`${index}-${place}`}>
              <a
                href={readHash(pageId)}
                aria-label={`${place.split('**').join('')}: see it in Page read`}
              >
                <Markdown inline baseLevel={3}>
                  {place}
                </Markdown>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pd2-muted">
          {level
            ? 'The gap row names no place on the page that covers this question.'
            : 'Run Content gaps to rate how well the page covers this question.'}
        </p>
      )}
      {row?.action ? (
        <div className="pd2-update">
          <p className="pd2-label">What to update</p>
          <p>
            <Markdown inline baseLevel={3}>
              {row.action}
            </Markdown>
          </p>
          <LinkButton
            size="sm"
            href={planFixHash(pageId, { description: row.action, promptIds: [row.promptId] })}
          >
            Plan as fix
          </LinkButton>
        </div>
      ) : null}
    </Card>
  )
}

/** FR-13.4: this prompt in each recent check, with content changes, as a list grid. */
export function TimelineCard({
  pageId,
  promptId,
  marketId,
  currentRunId = null,
  rows,
  error = null,
  onRetry,
  wording = null
}: {
  pageId: string
  /** With a market, each check opens this prompt as it was in that check. */
  promptId?: string
  marketId?: string
  /** The check shown above; its row is marked instead of linked. */
  currentRunId?: string | null
  rows: readonly PromptTimeRow[] | null
  /** The market's check history failed to load. */
  error?: string | null
  onRetry?: () => void
  /** When this market's wording last changed, and what it was. Earlier checks asked that. */
  wording?: { changedAt: string; previous: string } | null
}): JSX.Element {
  const linkFor = (row: PromptTimeRow): string | null =>
    promptId && marketId && row.runId !== currentRunId && row.status
      ? promptHash(pageId, row.promptId ?? promptId, { marketId, runId: row.runId })
      : null
  const columns: readonly ListColumn<PromptTimeRow>[] = [
    {
      id: 'check',
      label: 'Check',
      width: 'fill',
      minWidth: 200,
      sort: (row) => row.finishedAt,
      render: (row) => {
        const href = linkFor(row)
        const day = formatMoment(row.finishedAt)
        return (
          <span className="pd2-check-cell">
            {href ? (
              <a
                className="mono"
                href={href}
                aria-label={`Check on ${day}: show this question in that check`}
              >
                {day}
              </a>
            ) : (
              <span className="mono">{day}</span>
            )}
            {row.runId === currentRunId ? (
              <Chip size="sm" tone="info">
                Shown
              </Chip>
            ) : null}
            {row.partial ? <span className="pd2-faint">follow-up</span> : null}
            {row.earlierWording ? (
              <span title={`Asked: ${row.earlierWording}`}>
                <Chip size="sm">Earlier wording</Chip>
              </span>
            ) : null}
          </span>
        )
      }
    },
    {
      id: 'status',
      label: 'Status',
      width: 200,
      render: (row) =>
        row.status ? (
          <StatusChip status={row.status} />
        ) : (
          <span className="pd2-faint">Not in this check</span>
        )
    },
    {
      id: 'position',
      label: 'Position',
      width: 96,
      numeric: true,
      sort: (row) => row.position,
      render: (row) => (row.position === null ? '—' : row.position)
    },
    {
      id: 'pages',
      label: 'Your pages Google cited',
      width: 'fill',
      minWidth: 240,
      render: (row) =>
        row.status === null ? (
          <span className="pd2-faint">—</span>
        ) : (row.ownPages ?? []).length === 0 ? (
          <span className="pd2-faint">None</span>
        ) : (
          <span className="pd2-own-pages">
            {(row.ownPages ?? []).map((page) => (
              <span
                key={page.url}
                className={page.target ? 'pd2-own-page is-target' : 'pd2-own-page'}
                title={page.target ? 'One of your target pages' : 'Another page of yours'}
              >
                <span className="mono">{urlPath(page.url) ?? page.url}</span>
                <span className="pd2-faint"> #{page.position}</span>
              </span>
            ))}
          </span>
        )
    },
    {
      id: 'content',
      label: 'Page content',
      width: 176,
      render: (row) =>
        row.contentChanged && !row.first ? (
          <a className="pd2-changed" href={pageHash(pageId, 'history')}>
            {contentLabel(row)}
          </a>
        ) : (
          <span className="pd2-faint">{contentLabel(row)}</span>
        )
    }
  ]

  function menu(row: PromptTimeRow): MenuItem[] {
    const href = linkFor(row)
    return [
      ...(href
        ? [
            {
              id: 'open',
              label: 'Show this question in that check',
              icon: 'eye' as const,
              onSelect: () => navigateHash(href)
            }
          ]
        : []),
      {
        id: 'history',
        label: 'Compare content in History',
        icon: 'layers',
        onSelect: () => navigateHash(pageHash(pageId, 'history'))
      }
    ]
  }

  return (
    <Card headingId="pd-time-h" title="This question over time" className="pd2-grid-card">
      {wording ? (
        <p className="pd2-wording" role="note">
          <strong>Wording changed on {formatMoment(wording.changedAt)}.</strong> Checks before then
          asked “{wording.previous}”; their rows say Earlier wording. The old wording’s results are
          not counted for the new one.
        </p>
      ) : null}
      {error ? (
        <LoadError title="Could not load earlier checks." message={error} onRetry={onRetry} />
      ) : rows === null ? (
        <p role="status" className="pd2-muted">
          Loading earlier checks…
        </p>
      ) : (
        <ListGrid<PromptTimeRow>
          label="This question over time"
          noun={['check', 'checks']}
          rows={rows}
          rowKey={(row) => row.runId}
          rowLabel={(row) => `check on ${formatMoment(row.finishedAt)}`}
          columns={columns}
          rowMenu={menu}
          isRowCurrent={(row) => row.runId === currentRunId}
          pageSize="all"
          empty={<EmptyState compact title="No finished check in this market yet." />}
        />
      )}
    </Card>
  )
}

/** FR-13.5: the redacted raw Google and follow-up JSON, and the searches used. */
export function RawDataCard({
  samples,
  searchesUsed
}: {
  samples: readonly SampleCapture[]
  searchesUsed: number
}): JSX.Element {
  return (
    <Card headingId="pd-raw-h" title="Raw data">
      {samples.length === 0 ? <p className="pd2-muted">No search is stored yet.</p> : null}
      {samples.map((sample) => (
        <div key={sample.id} className="pd2-raw">
          {samples.length > 1 ? <p className="pd2-label">Sample {sample.sampleNo}</p> : null}
          <RawJson title="Google search JSON" body={sample.rawSearchJson} />
          <RawJson
            title="AI Overview follow-up JSON"
            body={sample.neededFollowup ? sample.rawAioJson : null}
            empty={sample.neededFollowup ? undefined : 'No follow-up was needed.'}
          />
        </div>
      ))}
      <p className="pd2-faint">
        <a
          href={sectionHash('connections')}
          aria-label={`${searchesUsed} ${searchesUsed === 1 ? 'search' : 'searches'} used: see key usage in Connections`}
        >
          {searchesUsed === 1 ? '1 search used' : `${searchesUsed} searches used`}
        </a>
        . Keys and tokens are removed from the stored JSON.
      </p>
    </Card>
  )
}

function RawJson({
  title,
  body,
  empty = 'Not stored.'
}: {
  title: string
  body: string | null
  empty?: string
}): JSX.Element {
  if (body === null) {
    return (
      <p className="pd2-faint">
        <span className="mono">{title}</span> · {empty}
      </p>
    )
  }
  return (
    <details className="pd2-details">
      <summary className="mono">{title}</summary>
      <pre className="pd2-json mono" tabIndex={0}>
        {pretty(body)}
      </pre>
    </details>
  )
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** "likely from <source>": moves to that source's line when it is in the list. */
function LikelySource({
  references,
  likely,
  onSource
}: {
  references: readonly AioReference[]
  likely: string
  onSource: (position: number) => void
}): JSX.Element {
  const source = sourceFor(references, likely)
  if (!source) return <span className="pd2-faint"> · likely from {likely}</span>
  return (
    <span className="pd2-faint">
      {' '}
      · likely from{' '}
      <button
        type="button"
        className="pd2-link-btn"
        aria-label={`Likely from ${likely}: go to source ${source.position}`}
        onClick={() => onSource(source.position)}
      >
        {likely}
      </button>
    </span>
  )
}
