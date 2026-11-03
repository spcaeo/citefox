import type { JSX, ReactNode } from 'react'
import type { AioReference, PageResults, PromptCheckRow } from '@shared/domain'
import type { ProjectCheck } from '@shared/ipc'
import { formatMoment } from '../../../utils/dates'
import { Chip, DrawerGrid, DrawerSection, EmptyState, ListGrid, UrlText } from '../../../ui'
import { changeText, changeTone } from '../model'
import {
  citedText,
  moveCounts,
  moveLabel,
  moveTone,
  overviewText,
  pairQuestions,
  positionText,
  totalsOf,
  type ComparedQuestion
} from '../utils/compare'

/** Sources shown per check in a question's detail before "+N more". */
const SOURCES_SHOWN = 8

/**
 * The Results tab of Compare checks: the two checks' totals and score change,
 * then every question side by side (AI Overview, cited, position, and who was
 * cited, expandable), so "what changed between these two checks?" is answered
 * before the page's content diff.
 */
export function CompareResults({
  pair,
  before,
  after,
  topic,
  domain
}: {
  pair: readonly [ProjectCheck, ProjectCheck]
  before: PageResults
  after: PageResults
  topic: boolean
  /** The project's own domain, for the own-site highlight on sources. */
  domain: string | null
}): JSX.Element {
  const [older, newer] = pair
  const questions = pairQuestions(before, after, topic)
  const a = totalsOf(before, topic)
  const b = totalsOf(after, topic)
  const moves = moveCounts(questions)
  const olderDay = formatMoment(older.startedAt)
  const newerDay = formatMoment(newer.startedAt)
  const rows: readonly { label: string; older: number | null; newer: number | null }[] = [
    { label: 'Score', older: a.score, newer: b.score },
    { label: 'Questions checked', older: a.questions, newer: b.questions },
    { label: 'AI Overviews', older: a.overviews, newer: b.overviews },
    { label: topic ? 'Cited (any page)' : 'Cited', older: a.cited, newer: b.cited },
    { label: 'Named', older: a.named, newer: b.named },
    { label: 'Searches used', older: older.searchesUsed, newer: newer.searchesUsed }
  ]
  return (
    <DrawerGrid>
      <DrawerSection
        title="Totals"
        description={`${olderDay} → ${newerDay}. ${movesLine(moves.gained, moves.lost)}`}
        span={12}
        testId="compare-totals"
      >
        <table className="hp-cmp-totals">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col">{olderDay}</th>
              <th scope="col">{newerDay}</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta = row.older === null || row.newer === null ? null : row.newer - row.older
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="num">{row.older ?? '—'}</td>
                  <td className="num">{row.newer ?? '—'}</td>
                  <td className={`num hist-${changeTone(delta)}`}>{changeText(delta)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DrawerSection>
      <DrawerSection
        title="Question by question"
        count={questions.length}
        description={`Each cell reads ${olderDay} → ${newerDay}. Expand a question to see who was cited.`}
        span={12}
        tone="plain"
      >
        <ListGrid<ComparedQuestion>
          label="Questions in both checks"
          noun={['question', 'questions']}
          rows={questions}
          rowKey={(row) => row.key}
          rowLabel={(row) => `${row.label}: ${row.text}`}
          virtualize={false}
          footer="paged"
          pageSize="all"
          columns={[
            {
              id: 'question',
              label: 'Question',
              width: 'fill',
              minWidth: 220,
              wrap: true,
              sort: (row) => row.position,
              render: (row) => (
                <span className="hp-cmp-question">
                  <span className="faint hp-cmp-q">{row.label}</span> {row.text}
                </span>
              )
            },
            {
              id: 'aio',
              label: 'AI Overview',
              width: 120,
              render: (row) => pairCell(overviewText(row.before), overviewText(row.after))
            },
            {
              id: 'cited',
              label: 'Cited',
              width: 136,
              render: (row) => pairCell(citedText(row.before, topic), citedText(row.after, topic))
            },
            {
              id: 'position',
              label: 'Position',
              width: 96,
              render: (row) =>
                pairCell(positionText(row.before, topic), positionText(row.after, topic))
            },
            {
              id: 'move',
              label: 'Change',
              width: 112,
              sort: (row) => row.move,
              render: (row) => (
                <Chip size="sm" tone={moveTone(row.move)}>
                  {moveLabel(row.move)}
                </Chip>
              )
            }
          ]}
          rowAlign="start"
          renderDetail={(row) => (
            <div className="hp-cmp-sources">
              <Sources day={olderDay} row={row.before} domain={domain} />
              <Sources day={newerDay} row={row.after} domain={domain} />
            </div>
          )}
          detailLabel={(row) => `who was cited for ${row.label}`}
          empty={
            <EmptyState
              title="Neither check has question results."
              body="A check that stopped before any question finished has nothing to compare."
            />
          }
        />
      </DrawerSection>
    </DrawerGrid>
  )
}

function movesLine(gained: number, lost: number): string {
  if (gained === 0 && lost === 0) return 'No question was gained or lost.'
  return `${gained} gained, ${lost} lost.`
}

/** "Yes → No", with the two sides named for screen readers. */
function pairCell(before: string, after: string): ReactNode {
  const changed = before !== after
  return (
    <span className={changed ? 'hp-cmp-pair hp-cmp-changed' : 'hp-cmp-pair'}>
      <span className="sr-only">Before: </span>
      <span className="hp-cmp-before">{before}</span>
      <span aria-hidden="true" className="faint">
        {' → '}
      </span>
      <span className="sr-only">, after: </span>
      <span className="hp-cmp-after">{after}</span>
    </span>
  )
}

/** Who the AI Overview cited for this question in one check, in position order. */
function Sources({
  day,
  row,
  domain
}: {
  day: string
  row: PromptCheckRow | null
  domain: string | null
}): JSX.Element {
  const references: readonly AioReference[] = row?.references ?? []
  const shown = references.slice(0, SOURCES_SHOWN)
  return (
    <div className="hp-cmp-side">
      <p className="hp-cmp-side-title">
        Cited on {day}
        <span className="faint"> · {references.length}</span>
      </p>
      {row === null ? (
        <p className="faint">Not asked in this check.</p>
      ) : references.length === 0 ? (
        <p className="faint">
          {row.status === 'no_aio' ? 'No AI Overview.' : 'No sources were saved.'}
        </p>
      ) : (
        <ol className="hp-cmp-refs">
          {shown.map((reference) => (
            <li key={reference.id}>
              <span className="faint num hp-cmp-pos">#{reference.position}</span>
              <UrlText
                url={reference.url}
                own={domain !== null && reference.domain.endsWith(domain)}
                {...(reference.classification === 'target' ? { kind: 'this page' } : {})}
              />
            </li>
          ))}
          {references.length > shown.length ? (
            <li className="faint">+{references.length - shown.length} more</li>
          ) : null}
        </ol>
      )}
    </div>
  )
}
