import { useId, useState, type JSX } from 'react'
import type { DiscoverSeedResult } from '@shared/ipc'
import { CompanyGroups } from '../../../fill/CompanyGroups'
import { SiteIcon } from '../../../siteIcon/SiteIcon'
import { AssistProgress, Button, IconButton, ToolButton, UiIcon } from '../../../ui'
import { aiFootnote, READS_SITE, type AiRunState } from '../hooks/useAiRun'

/**
 * "From example.com" (Seed-Input.png): problems to start from as a radio
 * list, segments to add to the profile, and what Claude found in three groups
 * (Docs/FEEDBACK.md row 3): competitors, what buyers switch from ("Use in buyer
 * questions" feeds the profile and questions), integrations ("Note as
 * integration"). Nothing changes until "Use as seed"; Undo puts the old seed back.
 */
export function DiscoveryCard({
  state,
  website,
  segments,
  onUseSeed,
  onToggleSegment,
  onUndo,
  onUseSwitchingFrom,
  onNoteIntegrations
}: {
  state: AiRunState<DiscoverSeedResult>
  website: string
  segments: readonly string[]
  /** The picked seed; its product (when it has one) becomes the topic's product. */
  onUseSeed: (seed: DiscoverSeedResult['seeds'][number]) => void
  onToggleSegment: (segment: string) => void
  onUndo: () => void
  onUseSwitchingFrom: (names: string[]) => void
  onNoteIntegrations: (names: string[]) => void
}): JSX.Element | null {
  const headingId = useId()
  const [picked, setPicked] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  if (state.phase === 'idle') return null
  const result = state.result
  const seeds = result?.seeds ?? []
  const choice = picked ?? seeds[seeds.length - 1]?.id ?? null
  const read = result?.pagesRead.filter((page) => page.ok).map((page) => page.role) ?? []

  return (
    <section
      className="ui-suggest tw-discovery"
      aria-labelledby={headingId}
      aria-busy={state.phase === 'running'}
    >
      <div className="ui-suggest-head">
        <span className="ui-suggest-mark" aria-hidden="true">
          <UiIcon name="sparkle" size={14} />
        </span>
        <div className="ui-suggest-titles">
          <h3 id={headingId}>
            From <SiteIcon domain={website} spaced />
            {website}
          </h3>
          {read.length > 0 ? <p className="ui-suggest-meta">{read.join(', ')}</p> : null}
        </div>
        <IconButton icon="x" size="sm" label="Dismiss suggestion" onClick={state.close} />
      </div>
      {state.phase === 'running' ? (
        <AssistProgress
          progress={state.progress}
          title="Reading your website"
          reads={READS_SITE}
          {...(state.seconds > 0 ? { expectedSeconds: state.seconds } : {})}
        />
      ) : state.phase === 'error' ? (
        <>
          <p className="ui-suggest-error" role="alert">
            {state.error}
          </p>
          <AssistProgress progress={state.progress} reads={READS_SITE} />
        </>
      ) : result ? (
        <>
          <AssistProgress progress={state.progress} reads={READS_SITE} />
          {result.message ? <p className="tw-muted">{result.message}</p> : null}
          <fieldset className="tw-fieldset">
            <legend className="tw-label">Problems to start from</legend>
            <ul className="tw-radio-list">
              {seeds.map((seed) => (
                <li key={seed.id}>
                  <label className={choice === seed.id ? 'tw-radio-row on' : 'tw-radio-row'}>
                    <input
                      type="radio"
                      name={`${headingId}-seed`}
                      checked={choice === seed.id}
                      onChange={() => setPicked(seed.id)}
                    />
                    <span className="tw-clamp">{seed.text}</span>
                    {seed.caution ? (
                      <span className="tw-warn-mark" title={seed.caution}>
                        <UiIcon name="warning" size={14} />
                        <span className="sr-only">{seed.caution}</span>
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {result.segments.length > 0 ? (
            <div className="tw-chip-group">
              <p className="tw-label">Segments for the profile</p>
              <div className="tw-chips">
                {result.segments.map((segment) => {
                  const on = segments.includes(segment.name)
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      className={on ? 'tw-chip-btn on' : 'tw-chip-btn'}
                      aria-pressed={on}
                      title={segment.reason}
                      onClick={() => onToggleSegment(segment.name)}
                    >
                      <UiIcon name={on ? 'check' : 'plus'} size={12} />
                      {segment.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <CompanyGroups
            site={website}
            competitors={result.competitors}
            switchingFrom={result.switchingFrom}
            integrations={result.integrations}
            headingLevel={4}
            competitorHint="Live products a buyer could choose instead. Add them in Project settings to track them."
            onUseSwitchingFrom={onUseSwitchingFrom}
            onNoteIntegrations={onNoteIntegrations}
          />
        </>
      ) : null}
      {state.phase !== 'running' ? (
        <div className="ui-suggest-foot">
          <div className="ui-suggest-actions">
            {result && !applied ? (
              <Button
                size="sm"
                disabled={!choice}
                onClick={() => {
                  const seed = seeds.find((item) => item.id === choice)
                  if (!seed) return
                  onUseSeed(seed)
                  setApplied(true)
                }}
              >
                Use as seed
              </Button>
            ) : null}
            {applied ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onUndo()
                  setApplied(false)
                }}
              >
                Undo
              </Button>
            ) : null}
            <ToolButton kind="refresh" label="Try again" onClick={() => state.retry()} />
          </div>
          {result ? (
            <p className="ui-suggest-note num">{aiFootnote(result.info, READS_SITE)}</p>
          ) : null}
          {result?.info?.notice ? (
            <p className="ui-suggest-note" role="status">
              {result.info.notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
