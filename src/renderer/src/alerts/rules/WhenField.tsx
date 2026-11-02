import { useId, type JSX } from 'react'
import type { AlertRuleWhen } from '@shared/ipc'
import { WHEN_OPTIONS, type RuleDraft } from './ruleModel'

/**
 * The When list: one radio per kind, with the kind's own value inline (the score
 * drop in points, the competitor's domain) so the sentence reads as one line.
 */
export function WhenField({
  draft,
  onDraft,
  scoreError,
  competitorError
}: {
  draft: RuleDraft
  onDraft: (patch: Partial<RuleDraft>) => void
  scoreError?: string
  competitorError?: string
}): JSX.Element {
  const name = useId()
  return (
    <fieldset className="ar-when" data-testid="rule-when">
      <legend className="sr-only">When</legend>
      {WHEN_OPTIONS.map((option) => {
        const checked = draft.when === option.id
        const hintId = `${name}-${option.id}-hint`
        return (
          <div key={option.id} className={checked ? 'ar-when-row on' : 'ar-when-row'}>
            <label className="ar-when-label">
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={checked}
                aria-describedby={hintId}
                onChange={() => onDraft({ when: option.id as AlertRuleWhen })}
              />
              <span>{option.label}</span>
            </label>
            {checked && option.id === 'score_drop' ? (
              <span className="ar-when-extra">
                <label htmlFor={`${name}-score`} className="sr-only">
                  Points
                </label>
                <input
                  id={`${name}-score`}
                  className="ob-input ar-num"
                  inputMode="numeric"
                  value={draft.scoreText}
                  aria-invalid={scoreError ? true : undefined}
                  onChange={(event) => onDraft({ scoreText: event.target.value })}
                />
                <span className="hint">points or more</span>
              </span>
            ) : null}
            {checked && option.id === 'competitor_cited' ? (
              <span className="ar-when-extra">
                <label htmlFor={`${name}-competitor`} className="sr-only">
                  Competitor domain
                </label>
                <input
                  id={`${name}-competitor`}
                  className="ob-input mono ar-domain"
                  placeholder="Any saved competitor, or competitor.example.com"
                  value={draft.competitorDomain ?? ''}
                  aria-invalid={competitorError ? true : undefined}
                  onChange={(event) => onDraft({ competitorDomain: event.target.value })}
                />
              </span>
            ) : null}
            <p id={hintId} className="ar-when-hint">
              {option.hint}
            </p>
            {checked && option.id === 'score_drop' && scoreError ? (
              <p className="ui-drawer-error" role="alert">
                {scoreError}
              </p>
            ) : null}
            {checked && option.id === 'competitor_cited' && competitorError ? (
              <p className="ui-drawer-error" role="alert">
                {competitorError}
              </p>
            ) : null}
          </div>
        )
      })}
    </fieldset>
  )
}
