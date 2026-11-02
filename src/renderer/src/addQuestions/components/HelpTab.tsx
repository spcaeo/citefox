import { useId, useState, type JSX } from 'react'
import { TOPIC_STAGE_LABEL } from '@shared/domain'
import type { HelpFillResult } from '@shared/ipc'
import {
  Button,
  Chip,
  HelpFill,
  UrlText,
  type HelpFillBot,
  type HelpFillChip,
  type HelpFillSource,
  type HelpFillWay
} from '../../ui'
import type { Suggestion, TargetKind } from '../types'
import { fullUrl, pathOf } from '../utils/targets'

/** `prompts.more` writes at most 12 in one call. */
const COUNTS = [5, 10, 12] as const

/**
 * ✦ Help me write (HelpFill.dc.html panels 1–3): the shared helper with both
 * ways. Describe it runs the `prompts.more` assist with the user's sentence;
 * Use your own ChatGPT copies a prompt that already lists what this page or
 * topic tracks and reads the pasted answer. The quick-start chips keep what this
 * tab offered before: start from the page, fill the stages with the fewest
 * questions, and Google's "People also ask" from the last check (free). Every
 * drafted row comes in ticked; ticked rows go into the rows below, where they are
 * checked like typed ones. Nothing is added until the footer's button.
 */
export function HelpTab({
  projectId,
  targetId,
  kind,
  source,
  way,
  bot,
  onWay,
  onBot,
  page,
  site,
  thin,
  items,
  seen,
  disabled,
  onRows,
  onAdd,
  onDismiss,
  openLink
}: {
  projectId: string
  targetId: string | null
  kind: TargetKind
  source: HelpFillSource
  way: HelpFillWay | null
  bot: HelpFillBot | null
  onWay: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
  /** The page the questions should cite (the target's or the default page), for the first chip. */
  page: string | null
  /** The site's address, so a drafted path opens on it. */
  site: string | null
  /** Stage labels with the fewest questions now ("Compare", "Decide"). */
  thin: readonly string[]
  /** Drafted rows waiting for review. */
  items: readonly Suggestion[]
  /** "People also ask" from the last check, not tracked yet. */
  seen: readonly Suggestion[]
  disabled: boolean
  onRows: (result: HelpFillResult, way: HelpFillWay) => void
  onAdd: (ids: readonly string[]) => void
  onDismiss: (ids: readonly string[]) => void
  openLink?: (url: string) => void
}): JSX.Element {
  const seenId = useId()
  const draftId = useId()
  // "People also ask" is free and already searched, so it shows by default; the chip hides it.
  const [showSeen, setShowSeen] = useState(true)
  // Drafted rows come in ticked (the mock-up's "tick the ones to keep"); only unticks are kept.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  // Seen-on-Google rows are not the user's ask, so they start unticked; only ticks are kept.
  const [tickedSeen, setTickedSeen] = useState<ReadonlySet<string>>(new Set())
  const shownSeen = showSeen ? seen : []
  const seenIds = new Set(shownSeen.map((item) => item.id))
  const all = [...shownSeen, ...items]
  const ticked = new Set(
    all
      .filter((item) => (seenIds.has(item.id) ? tickedSeen.has(item.id) : !unticked.has(item.id)))
      .map((item) => item.id)
  )
  const picked = [...ticked]

  const chips: HelpFillChip[] = []
  if (page !== null) {
    const path = pathOf(page)
    chips.push({
      id: 'page',
      label: `Start from my page ${path}`,
      text: `Questions a buyer asks before they would land on ${path}.`
    })
  }
  if (thin.length > 0) {
    chips.push({
      id: 'thin',
      label: `Fill ${joinWords(thin)} (fewest now)`,
      text: `Only questions for the ${joinWords(thin)} ${thin.length === 1 ? 'stage' : 'stages'}, which have the fewest questions now.`
    })
  }
  chips.push({
    id: 'competitor',
    label: "From a competitor's page",
    text: "Questions a buyer asks while reading a competitor's page, before they find ours."
  })
  if (seen.length > 0) {
    chips.push({
      id: 'paa',
      label: `Questions people also ask on Google (${seen.length})`,
      pressed: showSeen,
      onPick: () => setShowSeen((value) => !value)
    })
  }

  function toggle(id: string): void {
    const flip = seenIds.has(id) ? setTickedSeen : setUnticked
    flip((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="aq-card aq-suggest" data-testid="aq-suggest">
      {targetId === null ? (
        <p className="aq-hint">Pick a page or topic for the questions first.</p>
      ) : (
        <HelpFill
          kind="questions"
          projectId={projectId}
          scope={{ pageId: targetId }}
          source={source}
          way={way}
          onWay={onWay}
          bot={bot}
          onBot={onBot}
          disabled={disabled}
          describe={{
            label: "Who is searching, and what's their problem?",
            placeholder:
              'For example: IT teams whose carrier email-to-text stopped working, who need alerts that arrive by Friday.',
            chips,
            counts: COUNTS,
            defaultCount: 10,
            buttonLabel: (count) => `Write ${count} ${count === 1 ? 'question' : 'questions'}`
          }}
          chatbot={{
            pastePlaceholder: (name) => `Paste the CSV or table ${name} gave you…`
          }}
          onRows={onRows}
          {...(openLink ? { openLink } : {})}
          testId="aq-hf"
        />
      )}
      {shownSeen.length > 0 ? (
        <div className="aq-seen" data-testid="aq-seen-google">
          <p className="aq-label" id={seenId}>
            Seen on Google
          </p>
          <p className="aq-hint">
            People also ask on this {kind}&apos;s last check. Already searched, so no extra cost.
          </p>
          <IdeaList
            items={shownSeen}
            labelledBy={seenId}
            site={site}
            showPage={kind === 'topic'}
            ticked={ticked}
            disabled={disabled}
            onToggle={toggle}
          />
        </div>
      ) : null}
      {items.length > 0 ? (
        <>
          <p className="aq-label" id={draftId}>
            Drafted · tick the ones to keep
          </p>
          <IdeaList
            items={items}
            labelledBy={draftId}
            site={site}
            showPage={kind === 'topic'}
            ticked={ticked}
            disabled={disabled}
            onToggle={toggle}
          />
        </>
      ) : null}
      {all.length > 0 ? (
        <div className="aq-ideas-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || picked.length === 0}
            onClick={() => onAdd(picked)}
            data-testid="aq-ideas-add"
          >
            {picked.length > 0 ? `Add ${picked.length} to the rows` : 'Tick questions to add'}
          </Button>
          <Button
            variant="text"
            size="sm"
            disabled={disabled || picked.length === 0}
            onClick={() => onDismiss(picked)}
          >
            Dismiss {picked.length}
          </Button>
          <span className="aq-hint">
            Added rows are checked like typed ones. Nothing is saved yet.
          </span>
        </div>
      ) : null}
    </div>
  )
}

function IdeaList({
  items,
  labelledBy,
  site,
  showPage,
  ticked,
  disabled,
  onToggle
}: {
  items: readonly Suggestion[]
  labelledBy: string
  site: string | null
  /** A topic's rows each cite a page; a page's rows cite the page itself (as in RowsGrid). */
  showPage: boolean
  ticked: ReadonlySet<string>
  disabled: boolean
  onToggle: (id: string) => void
}): JSX.Element {
  return (
    <ul className="aq-ideas" aria-labelledby={labelledBy}>
      {items.map((item) => (
        <li key={item.id}>
          <label className="aq-check">
            <input
              type="checkbox"
              className="ui-check"
              checked={ticked.has(item.id)}
              disabled={disabled}
              onChange={() => onToggle(item.id)}
            />
            <span className="aq-idea-text">{item.text}</span>
          </label>
          <span className="aq-idea-meta">
            {item.stage ? (
              <Chip tone="neutral" size="sm">
                {TOPIC_STAGE_LABEL[item.stage]}
              </Chip>
            ) : null}
            {showPage && item.page ? <PageAddress page={item.page} site={site} /> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The page a drafted row cites, as its full address on the site (`example.com/`,
 * `example.com/pricing/`): a bare `/` alone reads oddly. Copy and Open as everywhere.
 */
function PageAddress({ page, site }: { page: string; site: string | null }): JSX.Element {
  const address = fullUrl(page, site)
  return address !== null && /^https?:\/\//iu.test(address) ? (
    <UrlText url={address} icon={false} />
  ) : (
    <UrlText path={page} icon={false} />
  )
}

/** "Compare", "Compare and Decide", "Fit, Compare and Decide". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`
}
