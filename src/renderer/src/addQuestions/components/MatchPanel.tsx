import { useState, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import {
  Button,
  HelpFill,
  UiIcon,
  UrlText,
  type HelpFillBot,
  type HelpFillSource,
  type HelpFillWay
} from '../../ui'
import type { DraftRow } from '../types'
import { matchItems, matchOutcome, matchSummary, type MatchOutcome } from '../utils/matchPages'

/** Describe's one call matches this many rows (the shared assist reply holds 40). */
const DESCRIBE_MAX = 40

/**
 * ✦ Match pages (HelpFill.dc.html panel 7, "Page to be cited"): the shared helper
 * for the rows of a topic. Describe it asks in-app Claude to pick the tracked page
 * for each row; Use your own ChatGPT copies a prompt that lists the rows and the
 * tracked pages and reads back `question,page`. Each matched row's page is set in
 * the rows above, where it can still be changed. A page that is not tracked is
 * flagged here and never set. Nothing is saved until the footer's button.
 */
export function MatchPanel({
  projectId,
  targetId,
  rows,
  site,
  source,
  way,
  bot,
  disabled,
  onWay,
  onBot,
  onPages,
  onClose,
  openLink
}: {
  projectId: string
  targetId: string
  rows: readonly DraftRow[]
  /** The site's address, so a flagged path opens on it. */
  site: string | null
  source: HelpFillSource
  way: HelpFillWay | null
  bot: HelpFillBot | null
  disabled: boolean
  onWay: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
  /** Sets each row's page (row key → tracked page URL). */
  onPages: (pages: ReadonlyMap<string, string>) => void
  onClose: () => void
  openLink?: (url: string) => void
}): JSX.Element {
  const items = matchItems(rows)
  const [outcome, setOutcome] = useState<MatchOutcome | null>(null)
  const count = Math.min(items.length, DESCRIBE_MAX)

  return (
    <div className="aq-card aq-match" id="aq-match" data-testid="aq-match">
      <div className="aq-match-head">
        <p className="aq-label">
          <UiIcon name="sparkle" size={14} className="aq-match-spark" />
          Match pages
        </p>
        <span className="aq-hint aq-match-lead">
          Picks the tracked page to be cited for each row. Pages you don&apos;t track are never set.
        </span>
        <Button variant="text" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <HelpFill
        kind="matchPages"
        projectId={projectId}
        scope={{ pageId: targetId }}
        items={items}
        source={source}
        way={way}
        onWay={onWay}
        bot={bot}
        onBot={onBot}
        disabled={disabled || items.length === 0}
        describe={{
          label: 'Anything CiteFox AI should know? (optional)',
          placeholder: 'For example: pricing questions go to the pricing page.',
          defaultCount: count,
          buttonLabel: () => `Match ${pluralize(count, 'question')}`
        }}
        ways={{
          describe: { text: 'CiteFox picks a tracked page for each row with CiteFox AI.' }
        }}
        chatbot={{
          pastePlaceholder: (name) => `Paste the question,page CSV ${name} gave you…`
        }}
        onRows={(result) => {
          const next = matchOutcome(rows, result)
          setOutcome(next)
          if (next.pages.size > 0) onPages(next.pages)
        }}
        {...(openLink ? { openLink } : {})}
        // The line under the panel says what was set and what was flagged.
        banner={false}
        testId="aq-match-hf"
      />
      {outcome ? (
        <div className="aq-notice aq-match-result" role="status" data-testid="aq-match-result">
          <p>{matchSummary(outcome)}</p>
          {outcome.untracked.length > 0 ? (
            <>
              <p className="aq-match-flag">
                <UiIcon name="warning" size={14} />
                {outcome.untracked.length === 1
                  ? '1 named a page you don’t track, so its page was not set:'
                  : `${outcome.untracked.length} named pages you don’t track, so their pages were not set:`}
              </p>
              <ul className="aq-match-list" aria-label="Pages you don’t track">
                {outcome.untracked.map((item) => (
                  <li key={item.key}>
                    <span className="aq-idea-text">{item.question}</span>
                    {/^https?:\/\//iu.test(item.page) ? (
                      <UrlText url={item.page} icon={false} />
                    ) : (
                      <UrlText path={item.page} siteBase={site} icon={false} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
