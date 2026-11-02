import { useState, type JSX } from 'react'
import { WRITE_WITH_URL } from '@shared/ipc'
import { sameTargetPage, targetPagePath } from '@shared/target-page'
import { BusyLine, Button, Chip, CopyText, DrawerSection, UiIcon, UrlText } from '../../../ui'
import type { TargetSuggestionsState } from '../hooks/useTargetSuggestions'
import { citedChips, suggestedRows } from '../model/suggested'

/** Rows shown before "Show all"; the selected, current and AI-picked pages always show. */
const SHOWN_FIRST = 5

const AI_MARK = (
  <>
    <UiIcon name="sparkle" size={12} /> CiteFox AI
  </>
)

/**
 * The target page drawer's "Suggested" section: the project's own pages the topic's
 * latest checks already cite (free), and ✦ Suggest with AI, whose picks join the same
 * list with their reason. "Use this page" puts a page in the field; nothing saves
 * until Save.
 */
export function SuggestedPages({
  state,
  domain,
  current,
  selected,
  pickNote,
  disabled,
  onUse
}: {
  state: TargetSuggestionsState
  domain: string | null
  /** The saved target page. */
  current: string | null
  /** The page in the field now. */
  selected: string | null
  /** Why the drawer preselected a page, while that page is still the one in the field. */
  pickNote: string | null
  disabled: boolean
  onUse: (value: string) => void
}): JSX.Element {
  const { cited, ai } = state
  const done = ai.phase === 'done' ? ai.result : null
  const rows = suggestedRows(cited, done)
  const [all, setAll] = useState(false)
  const shown = all
    ? rows
    : rows.filter(
        (row, index) =>
          index < SHOWN_FIRST ||
          row.aiRank !== null ||
          sameTargetPage(row.url, selected) ||
          sameTargetPage(row.url, current)
      )
  const running = ai.phase === 'running'
  const usual = [state.seconds, Math.max(state.seconds, Math.round(state.seconds * 1.5))] as const
  return (
    <DrawerSection
      title="Suggested"
      {...(cited !== null ? { count: rows.length } : {})}
      description={`Your pages that answers already cite for this topic, from the latest checks. Suggest with AI: CiteFox AI · about ${state.seconds} s · no searches.`}
      actions={
        <Button
          size="sm"
          icon="sparkle"
          busy={running}
          busyLabel="Suggesting…"
          disabled={disabled}
          onClick={state.askAi}
        >
          {done === null ? 'Suggest with AI' : 'Suggest again'}
        </Button>
      }
      loading={cited === null && state.citedError === null}
      error={state.citedError}
      onRetry={state.retryCited}
      testId="target-suggested"
    >
      {pickNote !== null ? (
        <p className="tr-suggest-pick" data-testid="target-pick-note">
          <UiIcon name="check" size={14} />
          <span>{pickNote}. Save to keep it.</span>
        </p>
      ) : null}
      {rows.length > 0 && cited !== null ? (
        <ul
          className="tr-suggest-list"
          aria-label="Suggested pages"
          data-guide="target-suggestions"
        >
          {shown.map((row) => {
            const path = targetPagePath(row.url)
            const isSelected = sameTargetPage(row.url, selected)
            return (
              <li
                key={row.url}
                className={isSelected ? 'tr-suggest tr-suggest-selected' : 'tr-suggest'}
              >
                <div className="tr-suggest-main">
                  <span className="tr-suggest-title">{row.title ?? path}</span>
                  <UrlText url={row.url} label={path} own />
                  {row.reason !== null ? (
                    <p className="tr-suggest-reason">
                      <Chip tone="info" size="sm" label={`CiteFox AI pick ${row.aiRank ?? ''}`}>
                        {AI_MARK}
                      </Chip>{' '}
                      {row.reason}
                    </p>
                  ) : null}
                  <span className="tr-suggest-chips">
                    {row.cited !== null ? (
                      citedChips(row.cited, cited).map((text, index) => (
                        <Chip key={text} size="sm" tone={index === 0 ? 'fox' : 'neutral'}>
                          {text}
                        </Chip>
                      ))
                    ) : (
                      <Chip size="sm">Not cited yet</Chip>
                    )}
                    {row.source === 'tracked' ? <Chip size="sm">Tracked</Chip> : null}
                    {sameTargetPage(row.url, current) ? (
                      <Chip size="sm" tone="ok" dot>
                        Current target
                      </Chip>
                    ) : null}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={isSelected ? 'ghost' : 'secondary'}
                  disabled={disabled || isSelected}
                  onClick={() => onUse(row.url)}
                >
                  {isSelected ? 'Selected' : 'Use this page'}
                  <span className="sr-only"> {path}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {rows.length > SHOWN_FIRST && (all || shown.length < rows.length) ? (
        <Button size="sm" variant="text" onClick={() => setAll((open) => !open)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </Button>
      ) : null}
      {cited !== null && rows.length === 0 && done === null ? (
        <p className="faint">
          {cited.checkedPrompts === 0
            ? 'This topic has no finished check yet, so no answer cites your pages. Suggest with AI picks from your pages, or pick one below.'
            : 'No answer cites your site for this topic yet. Suggest with AI picks from your pages, or pick one below.'}
        </p>
      ) : null}
      {done?.newPage ? (
        <div className="tr-suggest-new" data-testid="target-new-page">
          <p className="tr-suggest-reason">
            <Chip tone="info" size="sm">
              {AI_MARK}
            </Chip>{' '}
            {done.picks.length === 0 ? 'No page fits. Write a new page:' : 'Or write a new page:'}
          </p>
          <CopyText text={done.newPage.title} className="tr-suggest-title" />
          <UrlText path={done.newPage.path} siteBase={domain} />
          <p className="tr-suggest-about">{done.newPage.about}</p>
          <span className="tr-suggest-actions">
            <Button size="sm" disabled={disabled} onClick={() => onUse(done.newPage?.path ?? '')}>
              Use this path<span className="sr-only"> {done.newPage.path}</span>
            </Button>
            <a href={WRITE_WITH_URL} target="_blank" rel="noreferrer">
              Write with 1000AIOverviews
              <span className="sr-only"> (opens in your browser, sends no data)</span>
            </a>
          </span>
        </div>
      ) : null}
      <BusyLine
        active={running}
        label="CiteFox AI is picking the best page"
        usual={usual}
        note="No searches"
        end="CiteFox AI finished"
      />
      {ai.phase === 'error' ? (
        <p className="tr-suggest-error">
          <span className="ui-drawer-error" role="alert">
            {ai.message}
          </span>{' '}
          <Button size="sm" variant="text" onClick={state.askAi} disabled={disabled}>
            Try again
          </Button>
        </p>
      ) : null}
      {done !== null ? (
        <p className="faint" data-testid="target-ai-note">
          {[
            done.picks.length === 0 && done.newPage === null
              ? 'CiteFox AI found no page that fits'
              : null,
            `CiteFox AI · about ${Math.max(1, Math.round(done.info.durationMs / 1000))} s · no searches`,
            done.dropped > 0
              ? `left out ${done.dropped} ${done.dropped === 1 ? 'page' : 'pages'} not on your site's page list`
              : null
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      ) : null}
    </DrawerSection>
  )
}
