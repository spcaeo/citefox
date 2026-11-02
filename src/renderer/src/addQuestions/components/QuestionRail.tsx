import { useId, type JSX } from 'react'
import { TOPIC_STAGE_LABEL, type Market, type TopicStage } from '@shared/domain'
import type { QuestionTarget } from '@shared/ipc'
import { plainMarket } from '../../promptDetail/edit/model'
import { Button, UiIcon } from '../../ui'
import type { Suggestion, TargetKind } from '../types'
import { targetOption } from '../utils/copy'
import type { PageOption } from '../utils/rows'
import { pathOf } from '../utils/targets'

export interface QuestionRailProps {
  kind: TargetKind
  /** Every page and topic that takes questions, either kind. */
  targets: readonly QuestionTarget[]
  target: QuestionTarget | null
  blocked: QuestionTarget | null
  loading: boolean
  loadError: string | null
  pages: readonly PageOption[]
  defaultPage: string | null
  markets: readonly Market[]
  disabled: boolean
  onTarget: (id: string) => void
  onNewTopic: (() => void) | null
  onDefaultPage: (page: string | null) => void
  onAddPage: (() => void) | null
  missing: MissingPanelProps | null
}

/**
 * The right rail (AddQuestions.dc.html): where the questions go (+ New topic),
 * the default page to be cited (+ Add a page), the markets they are checked
 * in, and what the topic is missing.
 */
export function QuestionRail({
  kind,
  targets,
  target,
  blocked,
  loading,
  loadError,
  pages,
  defaultPage,
  markets,
  disabled,
  onTarget,
  onNewTopic,
  onDefaultPage,
  onAddPage,
  missing
}: QuestionRailProps): JSX.Element {
  const targetId = useId()
  const pageId = useId()
  const topics = targets.filter((item) => item.kind === 'topic')
  const pageTargets = targets.filter((item) => item.kind === 'page')
  const picked = target?.id ?? blocked?.id ?? ''
  return (
    <aside className="aq-rail" aria-label="Where the questions go">
      <div className="aq-field">
        <label className="aq-label" htmlFor={targetId}>
          {kind === 'topic' ? 'Topic' : 'Page'}
        </label>
        {loadError ? (
          <p className="aq-error" role="alert">
            {loadError}
          </p>
        ) : (
          <select
            id={targetId}
            className="ui-input aq-target"
            value={picked}
            disabled={disabled || loading}
            data-testid="aq-target"
            onChange={(event) => onTarget(event.target.value)}
          >
            {loading ? <option value="">Loading…</option> : null}
            {!loading && picked === '' ? <option value="">Pick a page or topic</option> : null}
            {blocked !== null ? (
              <option value={blocked.id} disabled>
                {blocked.name} · not tracked
              </option>
            ) : null}
            {topics.length > 0 ? (
              <optgroup label="Topics">
                {topics.map((item) => (
                  <option key={item.id} value={item.id}>
                    {targetOption(item)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {pageTargets.length > 0 ? (
              <optgroup label="Pages">
                {pageTargets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {targetOption(item)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        )}
        {blocked !== null ? (
          <p className="aq-hint aq-hint-bad">
            {blocked.name} is not tracked yet, so it cannot take questions. Pick another, or finish
            setting it up first.
          </p>
        ) : null}
        {onNewTopic ? (
          <button
            type="button"
            className="aq-link aq-add-link"
            disabled={disabled}
            onClick={onNewTopic}
          >
            <UiIcon name="plus" size={12} />
            New topic
          </button>
        ) : null}
      </div>

      {kind === 'topic' ? (
        <div className="aq-field">
          <label className="aq-label" htmlFor={pageId}>
            Default page to be cited
          </label>
          <select
            id={pageId}
            className="ui-input aq-mono"
            value={defaultPage ?? ''}
            disabled={disabled || target === null}
            data-testid="aq-default-page"
            onChange={(event) => onDefaultPage(event.target.value || null)}
          >
            <option value="">Pick a page</option>
            {pages.map((page) => (
              <option key={page.value} value={page.value}>
                {page.label}
              </option>
            ))}
            {defaultPage && !pages.some((page) => page.value === defaultPage) ? (
              <option value={defaultPage}>{pathOf(defaultPage)}</option>
            ) : null}
          </select>
          <p className="aq-hint">
            Rows can override it.
            {onAddPage ? (
              <>
                {' '}
                <button type="button" className="aq-link" disabled={disabled} onClick={onAddPage}>
                  + Add a page
                </button>{' '}
                if it isn’t tracked yet.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="aq-field">
        <span className="aq-label">Markets</span>
        <div className="aq-markets" data-testid="aq-markets">
          {markets.length === 0 ? (
            <span className="aq-hint">No market yet</span>
          ) : (
            markets.map((market) => (
              <span key={market.id} className="aq-market">
                {plainMarket(market)}
              </span>
            ))
          )}
        </div>
        <p className="aq-hint">
          Every question is checked in the {kind}’s markets. Change them on the {kind}.
        </p>
      </div>

      {missing ? <MissingPanel {...missing} /> : null}
    </aside>
  )
}

export interface MissingPanelProps {
  kind: TargetKind
  /** The thin stages with their counts, fewest first. Empty when none is thin. */
  thin: readonly { stage: TopicStage; count: number }[]
  items: readonly Suggestion[]
  busy: boolean
  error: string | null
  disabled: boolean
  onSuggest: (count: number) => void
  onAdd: (ids: readonly string[]) => void
}

/** "Missing from this topic": the stages with the fewest questions and Claude's ideas for them. */
export function MissingPanel({
  kind,
  thin,
  items,
  busy,
  error,
  disabled,
  onSuggest,
  onAdd
}: MissingPanelProps): JSX.Element | null {
  if (thin.length === 0 && items.length === 0) return null
  const shown = items.slice(0, 5)
  return (
    <section
      className="aq-missing"
      aria-label={`Missing from this ${kind}`}
      data-testid="aq-missing"
    >
      <h3 className="aq-missing-title">
        <UiIcon name="sparkle" size={14} />
        Missing from this {kind}
      </h3>
      {thin.length > 0 ? (
        <p className="aq-missing-text">
          Stages with the fewest questions:{' '}
          {thin.map((item) => `${TOPIC_STAGE_LABEL[item.stage]} (${item.count})`).join(', ')}.
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul className="aq-missing-list">
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="aq-plus"
                aria-label={`Add: ${item.text}`}
                disabled={disabled}
                onClick={() => onAdd([item.id])}
              >
                <UiIcon name="plus" size={12} />
              </button>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="aq-hint aq-hint-bad">{error}</p> : null}
      <div className="aq-missing-actions">
        {shown.length > 0 ? (
          <Button
            variant="text"
            size="sm"
            disabled={disabled}
            onClick={() => onAdd(shown.map((item) => item.id))}
          >
            Add all {shown.length}
          </Button>
        ) : null}
        <Button
          variant="text"
          size="sm"
          busy={busy}
          disabled={disabled || busy}
          onClick={() => onSuggest(shown.length > 0 ? 5 : 3)}
        >
          {shown.length > 0 ? 'Suggest 5 more' : 'Suggest 3 for these stages'}
        </Button>
      </div>
    </section>
  )
}
