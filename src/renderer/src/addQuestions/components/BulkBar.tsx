import { useId, type JSX } from 'react'
import {
  INTERVAL_DAYS,
  intervalDaysText,
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL,
  type IntervalDays
} from '@shared/domain'
import { Button, MenuButton, UiIcon } from '../../ui'
import type { DraftRow, TargetKind } from '../types'
import type { PageOption } from '../utils/rows'

const INTERVALS: readonly IntervalDays[] = INTERVAL_DAYS

export interface BulkBarProps {
  kind: TargetKind
  pages: readonly PageOption[]
  disabled: boolean
  expertOpen: boolean
  onExpert: (open: boolean) => void
  onSetAll: (patch: Pick<Partial<DraftRow>, 'stage' | 'page'>) => void
  onFill: () => void
  /** ✦ Match pages is open below the bar (topics only). */
  matchOpen?: boolean
  /** Opens or closes ✦ Match pages. Absent: no button. */
  onMatch?: (open: boolean) => void
}

/**
 * Set stage for all · Set page for all · ✦ Match pages · Match stages and pages by
 * keywords · › Expert options. ✦ Match pages (topics) opens the shared helper below.
 * The match is word matching in the renderer (`fillRows`), not Claude, so its
 * label and icon say so (W3I-C5).
 */
export function BulkBar({
  kind,
  pages,
  disabled,
  expertOpen,
  onExpert,
  onSetAll,
  onFill,
  matchOpen = false,
  onMatch
}: BulkBarProps): JSX.Element {
  return (
    <div className="aq-bulk">
      <MenuButton
        label="Set stage for all"
        align="start"
        items={[
          ...TOPIC_STAGES.map((stage) => ({
            id: stage,
            label: TOPIC_STAGE_LABEL[stage],
            onSelect: () => onSetAll({ stage })
          })),
          {
            id: 'none',
            label: 'No stage',
            groupStart: true,
            onSelect: () => onSetAll({ stage: '' })
          }
        ]}
        trigger={(props) => (
          <button type="button" className="aq-bulk-btn" disabled={disabled} {...props}>
            Set stage for all
            <UiIcon name="chevron-down" size={14} />
          </button>
        )}
      />
      {kind === 'topic' ? (
        <MenuButton
          label="Set page for all"
          align="start"
          width={280}
          items={[
            { id: 'default', label: 'The default page', onSelect: () => onSetAll({ page: '' }) },
            ...pages.map((page, index) => ({
              id: page.value,
              label: page.label,
              groupStart: index === 0,
              onSelect: () => onSetAll({ page: page.value })
            }))
          ]}
          trigger={(props) => (
            <button type="button" className="aq-bulk-btn" disabled={disabled} {...props}>
              Set page for all
              <UiIcon name="chevron-down" size={14} />
            </button>
          )}
        />
      ) : null}
      {kind === 'topic' && onMatch ? (
        <Button
          variant="secondary"
          size="sm"
          icon="sparkle"
          className="hf-spark-btn"
          disabled={disabled}
          aria-expanded={matchOpen}
          aria-controls="aq-match"
          onClick={() => onMatch(!matchOpen)}
          data-testid="aq-match-pages"
        >
          Match pages
        </Button>
      ) : null}
      <Button variant="secondary" size="sm" icon="list" disabled={disabled} onClick={onFill}>
        {kind === 'topic' ? 'Match stages and pages by keywords' : 'Match stages by keywords'}
      </Button>
      <button
        type="button"
        className="aq-expert-toggle"
        aria-expanded={expertOpen}
        aria-controls="aq-expert"
        onClick={() => onExpert(!expertOpen)}
      >
        <UiIcon name={expertOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        Expert options
      </button>
    </div>
  )
}

export interface ExpertPanelProps {
  kind: TargetKind
  showMarket: boolean
  showTags: boolean
  keywordRule: boolean
  intervalDays: IntervalDays | null
  disabled: boolean
  onShowMarket: (on: boolean) => void
  onShowTags: (on: boolean) => void
  onKeywordRule: (on: boolean) => void
  onInterval: (days: IntervalDays) => void
}

/** The settings most people never change: market per row, the keyword rule, how often, tags. */
export function ExpertPanel({
  kind,
  showMarket,
  showTags,
  keywordRule,
  intervalDays,
  disabled,
  onShowMarket,
  onShowTags,
  onKeywordRule,
  onInterval
}: ExpertPanelProps): JSX.Element {
  const intervalId = useId()
  const noun = kind === 'topic' ? 'topic' : 'page'
  return (
    <div className="aq-expert" id="aq-expert">
      <label className="aq-check">
        <input
          type="checkbox"
          className="ui-check"
          checked={showMarket}
          disabled={disabled}
          onChange={(event) => onShowMarket(event.target.checked)}
        />
        <span>
          A market for each row
          <span className="aq-hint">
            {' '}
            Rows are checked in it; it must be one of the {noun}’s markets.
          </span>
        </span>
      </label>
      {kind === 'topic' ? (
        <label className="aq-check">
          <input
            type="checkbox"
            className="ui-check"
            checked={keywordRule}
            disabled={disabled}
            onChange={(event) => onKeywordRule(event.target.checked)}
          />
          <span>
            Track short phrases as keywords
            <span className="aq-hint"> Four words or fewer, not asked as a question.</span>
          </span>
        </label>
      ) : null}
      <label className="aq-check">
        <input
          type="checkbox"
          className="ui-check"
          checked={showTags}
          disabled={disabled}
          onChange={(event) => onShowTags(event.target.checked)}
        />
        <span>
          Tags
          <span className="aq-hint">
            {' '}
            A note kept with each {kind === 'topic' ? 'question' : 'row'}.
          </span>
        </span>
      </label>
      <div className="aq-expert-field">
        <label className="aq-label" htmlFor={intervalId}>
          Check this {noun} every
        </label>
        <select
          id={intervalId}
          className="ui-input ui-input-sm aq-interval"
          value={intervalDays ?? ''}
          disabled={disabled || intervalDays === null}
          onChange={(event) => onInterval(Number(event.target.value) as IntervalDays)}
        >
          {intervalDays === null ? <option value="">—</option> : null}
          {INTERVALS.map((days) => (
            <option key={days} value={days}>
              {intervalDaysText(days)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
