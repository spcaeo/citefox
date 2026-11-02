import { useMemo, useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import type { HelpFillRow } from '@shared/ipc'
import {
  createHelpFillSource,
  HelpFill,
  IconButton,
  Panel,
  SuggestionCard,
  UiIcon,
  useHelpFillUrl,
  type AiAction,
  type HelpFillSource
} from '../../ui'
import { writeQuery } from '../../utils/queryState'
import { helpMeta, helpPatch, helpPoints, helpUndo } from './helpRows'
import type { ProfilePatch } from './model'

/** The helper's keys on the page's query (`au.help=describe|chatbot`, `au.bot=chatgpt`). */
const PREFIX = 'au.'

export interface BuyerHelp {
  /** "Help me fill this" for the profile's one AI menu. */
  action: AiAction
  /** The helper above the grid while `au.help` is on the URL, else null. */
  panel: JSX.Element | null
  /** The drafted points to tick and add, for the rail, else null. */
  card: JSX.Element | null
}

/**
 * ✦ Help me fill this on the buyer profile (HelpFill.dc.html panel 7, "Buyer profile
 * (Audience)"). The profile's AI menu opens the shared helper above the grid: Describe
 * it runs Sharpen and Find more trigger events with the user's sentence, or the user
 * copies one prompt into their own chatbot and pastes the answer back. The buyer types
 * it returns become segment, trigger and value suggestions in one review card, the
 * same card the AI menu's other actions use. Nothing is saved until Add, and Undo
 * puts the parts back. The way and the bot are on the URL; Back closes the helper.
 */
export function useBuyerHelp({
  projectId,
  pageId,
  profile,
  update,
  onAddedTriggers,
  source: sourceProp,
  openLink
}: {
  projectId: string
  pageId: string
  profile: BuyerProfile | null | undefined
  /** Saves a profile change; resolves to the saved profile, or null when it failed. */
  update: (patch: ProfilePatch, fallback: string) => Promise<BuyerProfile | null>
  /** Triggers just added, so the grid marks them New. */
  onAddedTriggers: (texts: readonly string[], added: boolean) => void
  /** Tests only. Production uses the preload bridge. */
  source?: HelpFillSource
  openLink?: (url: string) => void
}): BuyerHelp {
  const source = useMemo(() => sourceProp ?? createHelpFillSource(), [sourceProp])
  const url = useHelpFillUrl(PREFIX)
  // The last answer for this page, read against the profile as it was then, so the
  // points stay listed after Add (Undo puts them back).
  const [answer, setAnswer] = useState<{
    pageId: string
    rows: readonly HelpFillRow[]
    base: BuyerProfile
    /** A new answer starts a fresh card (all ticked again). */
    seq: number
  } | null>(null)
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null)
  const current = answer?.pageId === pageId ? answer : null
  const points = useMemo(
    () => (current === null ? [] : helpPoints(current.rows, current.base)),
    [current]
  )

  const action: AiAction = {
    id: 'helpfill',
    label: 'Help me fill this',
    icon: 'sparkle',
    onSelect: () => url.onWay(url.way ?? 'describe')
  }

  const close = (): void => writeQuery({ [`${PREFIX}help`]: null, [`${PREFIX}bot`]: null }, 'push')

  async function add(ids: readonly string[]): Promise<void> {
    if (!profile) return
    const patch = helpPatch(profile, points, ids)
    const previous = helpUndo(profile, patch)
    const added = (patch.triggers ?? []).slice(profile.triggers.length)
    if ((await update(patch, 'Could not add the points.')) === null) return
    onAddedTriggers(added, true)
    if (previous === null) return
    setUndo(() => async () => {
      if ((await update(previous, 'Could not undo the change.')) !== null) {
        onAddedTriggers(added, false)
        setUndo(null)
      }
    })
  }

  const panel =
    url.way === null || !profile ? null : (
      <Panel
        className="au-help"
        titleAs="h3"
        title={
          <span className="au-help-title">
            <span className="au-help-spark" aria-hidden="true">
              <UiIcon name="sparkle" size={14} />
            </span>
            Help me fill this
          </span>
        }
        actions={<IconButton icon="x" size="sm" label="Close the helper" onClick={close} />}
      >
        <p className="au-note">
          Buyer types for this page: their segment, the event that sends them searching, and what
          they value. You tick what to add; nothing is saved before that.
        </p>
        <HelpFill
          kind="buyers"
          projectId={projectId}
          scope={{ pageId }}
          source={source}
          {...url}
          describe={{
            label: 'Who are your best customers, and what sends them looking?',
            placeholder:
              'Our best customers are… For example: clinic office managers who lose shift changes in email.',
            chips: [
              {
                id: 'page',
                label: 'From what this page says',
                text: 'Buyer types this page is written for, from what it says.'
              },
              {
                id: 'events',
                label: 'Mostly trigger events',
                text: 'Mostly new trigger events: what happens that sends them searching now.'
              }
            ],
            buttonLabel: () => 'Draft buyer segments'
          }}
          chatbot={{
            pastePlaceholder: (name) => `Paste the table ${name} gave you…`
          }}
          onRows={(result) => {
            setUndo(null)
            setAnswer((last) => ({
              pageId,
              rows: result.rows,
              base: profile,
              seq: (last?.seq ?? 0) + 1
            }))
          }}
          {...(openLink ? { openLink } : {})}
          testId="au-hf"
        />
      </Panel>
    )

  const card =
    current === null || !profile ? null : (
      <SuggestionCard
        key={current.seq}
        title="Buyer types to add"
        meta={helpMeta(points)}
        items={points}
        footnote="Adding a point doesn’t change saved questions."
        {...(points.length > 0
          ? { onApply: (ids: string[]) => void add(ids), applyLabel: 'Add to the profile' }
          : {})}
        {...(undo ? { onUndo: () => void undo() } : {})}
        onClose={() => {
          setAnswer(null)
          setUndo(null)
        }}
      />
    )

  return { action, panel, card }
}
