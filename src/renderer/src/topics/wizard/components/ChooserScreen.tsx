import { useState, type JSX } from 'react'
import { Button, IconButton, LinkButton, Panel, UiIcon, type UiIconName } from '../../../ui'
import { startHash } from '../../../shell/routes'
import { readStartChoice, saveStartChoice } from '../../../start/choice'
import type { StartWay } from '../../../start/examples'
import { startWayOptions } from '../../../start/ways'
import { WayList, type WayOption } from '../../../ui'
import type { WayToStart } from '../startWay'
import type { TopicDraftSummary } from '@shared/domain'
import type { TopicSuggestedStart } from '@shared/ipc'
import { PATH_CRUMB } from '../constants'
import { aiFootnote, READS_SAVED } from '../hooks/useAiRun'
import type { WizardProject } from '../types'
import { SETUP_HREF } from '../../../permissions/model'
import './chooser.css'

export type ChooserPick = WayToStart

/** Short tags at the end of each row. The ways themselves are the shared start list. */
const TAGS: Record<StartWay, readonly string[]> = {
  page: ['Needs a URL', '10 questions'],
  seed: ['No URL needed', 'Questions, keywords or both'],
  keywords: ['No URL needed', 'Grouped by intent'],
  questions: ['Paste or CSV', 'Buyer wording kept'],
  competitor: ['Needs their URL', 'Brands removed'],
  gsc: []
}

const GIVES: readonly { icon: UiIconName; title: string; body: string }[] = [
  {
    icon: 'target',
    title: 'One cluster goal',
    body: 'Cited in 50–70% of questions with an overview'
  },
  {
    icon: 'chart',
    title: 'Coverage by journey stage',
    body: 'Problem, Options, Doubts, Fit, Compare, Decide'
  },
  {
    icon: 'list',
    title: 'A ranked to-do list',
    body: 'Right page, wrong page, not cited, no page yet'
  }
]

function relativeDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * "What do you want to track?" (Mockups/v2/Main.png): the four starting points
 * as the shared compact chooser (ui/WayList, the same rows as "How do you
 * want to start?"), Search Console marked "Coming later", "Let CiteFox set up
 * your site" above, and on the right Claude's suggested start from saved
 * project data and unfinished drafts to pick up again. Each option shows a
 * one-line example from the saved profile (owner feedback 6).
 */
export function ChooserScreen({
  project,
  suggested,
  claudeMissing = false,
  onCheckClaude,
  drafts,
  busy,
  error,
  onContinue,
  onResume,
  onCancel
}: {
  /** The open project; its saved profile feeds the examples. */
  project?: WizardProject
  suggested: TopicSuggestedStart | null
  /** Claude is not ready, so no suggestion was asked for; offer to connect it instead. */
  claudeMissing?: boolean
  /** Claude is saved but not checked yet: check it now, on the user's click. */
  onCheckClaude?: () => void
  drafts: readonly TopicDraftSummary[]
  busy: boolean
  error: string | null
  onContinue: (pick: ChooserPick, seed?: string, productId?: string | null) => void
  onResume: (draftId: string) => void
  onCancel: () => void
}): JSX.Element {
  const [pick, setPick] = useState<ChooserPick>('seed')
  const [showSuggestion, setShowSuggestion] = useState(true)
  const [why, setWhy] = useState(false)
  const profile = project ?? {}
  const chosen = project ? readStartChoice(project.id) : null
  const options: readonly WayOption<StartWay>[] = startWayOptions(profile, suggested?.seed).map(
    (option) => ({
      ...option,
      tags: TAGS[option.id],
      suggested: option.id === 'seed' && suggested !== null
    })
  )

  return (
    <div className="tw tw-chooser">
      <div className="tw-body">
        <div className="tw-head">
          <div className="tw-titles">
            <h1>What do you want to track?</h1>
            <p className="tw-aside">Pick a starting point. Every path ends in a scored topic.</p>
          </div>
          {chosen ? (
            <a className="twc-change" href={startHash('choose')}>
              Change how to start
            </a>
          ) : null}
        </div>
        {error ? (
          <p className="tw-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ui-layout-main-rail">
          <div className="tw-main">
            <Panel padding={0} label="Let CiteFox set up your site" className="twc-auto">
              <div className="twc-auto-row">
                <span className="twc-icon" aria-hidden="true">
                  <UiIcon name="sparkle" size={16} />
                </span>
                <span className="twc-auto-text">
                  <span className="twc-auto-title">Let CiteFox set up your site</span>
                  <span className="tw-muted">
                    Reads your site, picks the pages and a topic that matter. No searches.
                  </span>
                </span>
                <LinkButton
                  href={startHash('setup')}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (project) saveStartChoice(project.id, 'autopilot')
                  }}
                >
                  Set up my site
                </LinkButton>
              </div>
            </Panel>
            <Panel padding={0} label="Starting points">
              <WayList
                label="Starting point"
                name="tw-start"
                options={options}
                value={pick}
                onChange={(id) => {
                  // Search Console is "Coming later": its radio is disabled.
                  if (id !== 'gsc') setPick(id)
                }}
              />
            </Panel>
          </div>
          <aside className="tw-rail" aria-label="Suggestions">
            {suggested && showSuggestion ? (
              <Panel
                title={
                  <span className="twc-suggest-title">
                    <span className="ui-suggest-mark" aria-hidden="true">
                      <UiIcon name="sparkle" size={14} />
                    </span>
                    Suggested start
                  </span>
                }
                actions={
                  <IconButton
                    icon="x"
                    size="sm"
                    tip
                    label="Dismiss suggested start"
                    onClick={() => setShowSuggestion(false)}
                  />
                }
                padding={20}
              >
                <p className="twc-seed">“{suggested.seed}”</p>
                <dl className="twc-facts">
                  {suggested.facts.map((fact) => (
                    <div key={fact.text}>
                      <dt className="num">{fact.value}</dt>
                      <dd>{fact.text}</dd>
                    </div>
                  ))}
                </dl>
                {why ? <p className="twc-why">{suggested.why}</p> : null}
                <div className="twc-suggest-foot">
                  <Button
                    size="sm"
                    onClick={() => onContinue(suggested.path, suggested.seed, suggested.productId)}
                    disabled={busy}
                  >
                    Use this start
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={why}
                    onClick={() => setWhy((value) => !value)}
                  >
                    {why ? 'Hide reasons' : 'Why this?'}
                  </Button>
                  <span className="tw-note num">{aiFootnote(suggested.info, READS_SAVED)}</span>
                </div>
              </Panel>
            ) : claudeMissing ? (
              <Panel title="Suggested start" titleAs="h2" padding={20}>
                <p className="tw-muted">
                  CiteFox can suggest a problem to start from once CiteFox AI is connected. Until
                  then, pick a starting point on the left.
                </p>
                <div className="twc-suggest-foot">
                  {onCheckClaude ? (
                    <Button size="sm" onClick={onCheckClaude}>
                      Check the AI and suggest
                    </Button>
                  ) : null}
                  <LinkButton
                    href={SETUP_HREF.claude ?? '#/connections'}
                    size="sm"
                    variant={onCheckClaude ? 'ghost' : 'secondary'}
                  >
                    Connect an AI
                  </LinkButton>
                </div>
              </Panel>
            ) : null}
            {drafts.length > 0 ? (
              <Panel title="Pick up where you left off" titleAs="h2" padding={20}>
                <ul className="twc-drafts">
                  {drafts.slice(0, 3).map((draft) => (
                    <li key={draft.id}>
                      <Button variant="text" onClick={() => onResume(draft.id)}>
                        {draft.name.trim() || PATH_CRUMB[draft.path]}
                      </Button>
                      <span className="tw-muted num">
                        {PATH_CRUMB[draft.path]} · {relativeDay(draft.updatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            <Panel title="What a topic gives you" titleAs="h2" padding={20}>
              <ul className="twc-gives">
                {GIVES.map((item) => (
                  <li key={item.title}>
                    <span className="twc-icon" aria-hidden="true">
                      <UiIcon name={item.icon} size={16} />
                    </span>
                    <span className="twc-gives-text">
                      <span className="twc-gives-title">{item.title}</span>
                      <span className="tw-muted">{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </div>
      <footer className="ui-wizard-foot">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <div className="ui-wizard-end">
          <p className="ui-wizard-note">
            <span>No searches are used until you start a check.</span>
          </p>
          <Button
            variant="primary"
            iconEnd="arrow-right"
            busy={busy}
            onClick={() => onContinue(pick)}
          >
            {pick === 'page' ? 'Open Add a page' : 'Continue'}
          </Button>
        </div>
      </footer>
    </div>
  )
}
