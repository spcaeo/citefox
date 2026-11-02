import type { JSX, KeyboardEvent } from 'react'
import { TOPIC_STAGES, TOPIC_STAGE_LABEL, type Market, type TopicStage } from '@shared/domain'
import { resultPill } from '../../importFlow/model'
import { Chip, IconButton } from '../../ui'
import type { DraftRow, RowCheck, TargetKind } from '../types'
import { isBlank, type PageOption } from '../utils/rows'
import { pathOf } from '../utils/targets'

/** Rows drawn at once; the rest wait behind "Show all". */
export const ROWS_SHOWN = 200

export interface RowsGridProps {
  rows: readonly DraftRow[]
  checks: ReadonlyMap<string, RowCheck>
  kind: TargetKind
  pages: readonly PageOption[]
  defaultPage: string | null
  markets: readonly Market[]
  /** Every market of the project, to name and add a row's market the target does not check. */
  projectMarkets?: readonly Market[]
  showMarket: boolean
  showTags: boolean
  disabled: boolean
  showAll: boolean
  onShowAll: () => void
  onCell: (key: string, patch: Partial<DraftRow>) => void
  onPaste: (key: string, text: string) => boolean
  onRemove: (key: string) => void
  onKeepBoth: (key: string) => void
}

/**
 * The structured rows (AddQuestions.dc.html): each question with its own stage,
 * the page that should be cited, the live check and ✕. A block pasted from a
 * sheet splits into rows and cells; Enter goes to the next row. Rows from a file
 * with a Topic column show it (W3I-C3); a topic that does not exist yet can be
 * created, and a market the page or topic does not check can be added (W3I-C1).
 */
export function RowsGrid({
  rows,
  checks,
  kind,
  pages,
  defaultPage,
  markets,
  projectMarkets = markets,
  showMarket,
  showTags,
  disabled,
  showAll,
  onShowAll,
  onCell,
  onPaste,
  onRemove,
  onKeepBoth
}: RowsGridProps): JSX.Element {
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN)
  const hidden = rows.length - shown.length
  const showTopic = rows.some((row) => row.topic.trim().length > 0)
  const noun = kind === 'topic' ? 'this topic' : 'this page'
  const defaultLabel = defaultPage === null ? 'Pick a page' : pathOf(defaultPage)
  return (
    <div className="aq-card">
      <table className="aq-rows" data-testid="aq-rows">
        <thead>
          <tr>
            <th scope="col" className="aq-c-num">
              #
            </th>
            <th scope="col" className="aq-c-q">
              Question
            </th>
            <th scope="col" className="aq-c-stage">
              Stage
            </th>
            {kind === 'topic' ? (
              <th scope="col" className="aq-c-page">
                Page to be cited
              </th>
            ) : null}
            {showTopic ? (
              <th scope="col" className="aq-c-topic">
                Topic
              </th>
            ) : null}
            {showMarket ? (
              <th scope="col" className="aq-c-market">
                Market
              </th>
            ) : null}
            {showTags ? (
              <th scope="col" className="aq-c-tags">
                Tags
              </th>
            ) : null}
            <th scope="col" className="aq-c-check">
              Check
            </th>
            <th scope="col" className="aq-c-x">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => {
            const blank = isBlank(row)
            const check = blank ? undefined : checks.get(row.key)
            const n = index + 1
            return (
              <tr key={row.key} className={rowClass(check)} data-row={row.key}>
                <td className="aq-c-num num">{n}</td>
                <td className="aq-c-q">
                  <textarea
                    className={check?.result === 'duplicate' ? 'aq-q aq-q-dup' : 'aq-q'}
                    aria-label={`Question ${n}`}
                    rows={1}
                    value={row.question}
                    disabled={disabled}
                    placeholder={blank ? 'Type a question, or paste many rows…' : undefined}
                    data-q={row.key}
                    data-autofocus={index === 0 ? true : undefined}
                    onChange={(event) => onCell(row.key, { question: event.target.value })}
                    onPaste={(event) => {
                      if (onPaste(row.key, event.clipboardData.getData('text/plain'))) {
                        event.preventDefault()
                      }
                    }}
                    onKeyDown={(event) => nextOnEnter(event, row.key)}
                  />
                  {check ? (
                    <CheckNote
                      check={check}
                      keep={row.keep}
                      onKeep={() => onKeepBoth(row.key)}
                      onUseTracked={() => onRemove(row.key)}
                      fix={fixFor(check, row, projectMarkets, noun, (patch) =>
                        onCell(row.key, patch)
                      )}
                    />
                  ) : null}
                </td>
                <td className="aq-c-stage">
                  {blank ? null : (
                    <select
                      className="aq-sel"
                      aria-label={`Stage of question ${n}`}
                      value={row.stage}
                      disabled={disabled}
                      onChange={(event) =>
                        onCell(row.key, { stage: event.target.value as TopicStage | '' })
                      }
                    >
                      <option value="">—</option>
                      {TOPIC_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {TOPIC_STAGE_LABEL[stage]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                {kind === 'topic' ? (
                  <td className="aq-c-page">
                    {blank ? null : (
                      <select
                        className={
                          row.page || defaultPage
                            ? 'aq-sel aq-sel-mono'
                            : 'aq-sel aq-sel-mono aq-sel-empty'
                        }
                        aria-label={`Page to be cited for question ${n}`}
                        value={row.page}
                        disabled={disabled}
                        onChange={(event) => onCell(row.key, { page: event.target.value })}
                      >
                        <option value="">{defaultLabel}</option>
                        {optionsWith(pages, row.page).map((page) => (
                          <option key={page.value} value={page.value}>
                            {page.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                ) : null}
                {showTopic ? (
                  <td className="aq-c-topic">
                    {blank ? null : (
                      <input
                        className="aq-tags"
                        aria-label={`Topic of question ${n}`}
                        value={row.topic}
                        disabled={disabled}
                        placeholder="The picked one"
                        onChange={(event) => onCell(row.key, { topic: event.target.value })}
                      />
                    )}
                  </td>
                ) : null}
                {showMarket ? (
                  <td className="aq-c-market">
                    {blank ? null : (
                      <select
                        className="aq-sel"
                        aria-label={`Market of question ${n}`}
                        value={row.market}
                        disabled={disabled}
                        onChange={(event) => onCell(row.key, { market: event.target.value })}
                      >
                        <option value="">All</option>
                        {markets.map((market) => (
                          <option key={market.id} value={market.id}>
                            {market.country.toUpperCase()}
                            {market.location ? ` · ${market.location}` : ''}
                          </option>
                        ))}
                        {row.market && !markets.some((market) => market.id === row.market) ? (
                          <option value={row.market}>
                            {projectMarkets
                              .find((market) => market.id === row.market)
                              ?.country.toUpperCase() ?? row.market}
                          </option>
                        ) : null}
                      </select>
                    )}
                  </td>
                ) : null}
                {showTags ? (
                  <td className="aq-c-tags">
                    {blank ? null : (
                      <input
                        className="aq-tags"
                        aria-label={`Tags of question ${n}`}
                        value={row.tags}
                        disabled={disabled}
                        placeholder="Add tags"
                        onChange={(event) => onCell(row.key, { tags: event.target.value })}
                      />
                    )}
                  </td>
                ) : null}
                <td className="aq-c-check">
                  {blank ? null : check === undefined ? (
                    <span className="aq-pending">Checking…</span>
                  ) : (
                    <Chip tone={resultPill(check).tone} size="sm">
                      {check.result === 'new' && row.keep ? 'Kept' : resultPill(check).label}
                    </Chip>
                  )}
                </td>
                <td className="aq-c-x">
                  {blank ? null : (
                    <IconButton
                      icon="x"
                      label={`Remove question ${n}`}
                      size="sm"
                      className="aq-x"
                      disabled={disabled}
                      onClick={() => onRemove(row.key)}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {hidden > 0 ? (
        <button type="button" className="aq-more" onClick={onShowAll}>
          Show all {rows.length.toLocaleString('en-US')} rows ({hidden.toLocaleString('en-US')}{' '}
          more)
        </button>
      ) : null}
    </div>
  )
}

/** One-click ways out of a "Needs a fix" row: two links under its reason. */
interface RowFix {
  first: { label: string; onClick: () => void }
  second: { label: string; onClick: () => void } | null
}

/**
 * A topic the Topic cell names that does not exist yet: create it, or use the
 * picked one. A market the page or topic does not check: add it there, or check
 * the question in its markets.
 */
function fixFor(
  check: RowCheck,
  row: DraftRow,
  markets: readonly Market[],
  noun: string,
  onCell: (patch: Partial<DraftRow>) => void
): RowFix | null {
  if (check.result !== 'fix') return null
  if (check.fix === 'topic' && row.topic.trim()) {
    return {
      first: { label: 'create it', onClick: () => onCell({ createTopic: true }) },
      second: { label: 'use the picked one', onClick: () => onCell({ topic: '' }) }
    }
  }
  if (check.fix === 'market' && row.market) {
    const known = markets.find((market) => market.id === row.market)
    const second = { label: 'check it in every market', onClick: () => onCell({ market: '' }) }
    if (known === undefined) return { first: second, second: null }
    return {
      first: {
        label: `add ${known.country.toUpperCase()} to ${noun}`,
        onClick: () => onCell({ addMarket: true })
      },
      second
    }
  }
  return null
}

/** The line under a checked question: why it is not plain new, and the choice for a similar one. */
function CheckNote({
  check,
  keep,
  onKeep,
  onUseTracked,
  fix
}: {
  check: RowCheck
  keep: boolean
  onKeep: () => void
  onUseTracked: () => void
  fix: RowFix | null
}): JSX.Element | null {
  if (check.result === 'similar' && !keep) {
    return (
      <span className="aq-note">
        {check.reason}{' '}
        <button type="button" className="aq-link" onClick={onKeep}>
          keep both
        </button>
        {' · '}
        <button type="button" className="aq-link" onClick={onUseTracked}>
          use tracked
        </button>
      </span>
    )
  }
  if (check.reason === null) return null
  return (
    <span className={check.result === 'fix' ? 'aq-note aq-note-bad' : 'aq-note'}>
      {check.reason}
      {fix ? (
        <>
          {' '}
          <button type="button" className="aq-link" onClick={fix.first.onClick}>
            {fix.first.label}
          </button>
          {fix.second ? (
            <>
              {' · '}
              <button type="button" className="aq-link" onClick={fix.second.onClick}>
                {fix.second.label}
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </span>
  )
}

function rowClass(check: RowCheck | undefined): string | undefined {
  if (check?.result === 'similar') return 'aq-row-similar'
  if (check?.result === 'duplicate') return 'aq-row-dup'
  if (check?.result === 'fix') return 'aq-row-fix'
  return undefined
}

/** Enter moves to the next row's question (Shift+Enter is a plain new line). */
function nextOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, key: string): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  const table = event.currentTarget.closest('table')
  const boxes = Array.from(table?.querySelectorAll<HTMLTextAreaElement>('textarea[data-q]') ?? [])
  const at = boxes.findIndex((box) => box.dataset.q === key)
  // The next row may only appear after this render (the new empty tail row).
  window.requestAnimationFrame(() => {
    const again = Array.from(table?.querySelectorAll<HTMLTextAreaElement>('textarea[data-q]') ?? [])
    ;(again[at + 1] ?? boxes[at + 1])?.focus()
  })
}

function optionsWith(pages: readonly PageOption[], value: string): readonly PageOption[] {
  if (!value || pages.some((page) => page.value === value)) return pages
  return [...pages, { value, label: pathOf(value) }]
}
