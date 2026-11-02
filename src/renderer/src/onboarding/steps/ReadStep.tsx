import { useId, useMemo, type JSX } from 'react'
import { HELPFILL_BOTS, type HelpFillBot } from '@shared/helpfill'
import type { HelpFillSetupSite, SetupReadWay } from '@shared/ipc'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { usableDomain, useSetupHelp } from '../../fill/setupHelp/useSetupHelp'
import { formatElapsed, openInBrowser, rememberBot, rememberedBot, UiIcon, useNow } from '../../ui'
import { ChatbotSteps } from '../../ui/HelpFill/ChatbotSteps'
import { useQueryState } from '../../utils/queryState'
import type { SetupServices } from '../setupServices'
import { applyChatbotAnswer } from '../setupApply'
import { keptCount, stepKicker } from '../setupSteps'
import { StepPage } from '../StepPage'
import { normalizeCountry, normalizeDomain, normalizeLanguageTag } from '../validate'
import { ReadProgress } from './ReadProgress'
import { retrying } from './readLive'
import { OpenSearches } from './SearchLines'
import type { SetupStepProps } from './types'
import type { SiteRead } from './useSiteRead'
import './setup-steps.css'

export interface ReadStepProps extends SetupStepProps {
  read: SiteRead
  services: SetupServices
  /** False: no Claude connection, so "Read my website" cannot run. Null while unknown. */
  claudeAvailable: boolean | null
  /** Why Claude is not available, in plain words. */
  claudeReason: string | null
  /** Test seam for "Open ChatGPT". */
  openLink?: (url: string) => void
}

const WAYS: readonly SetupReadWay[] = ['claude', 'chatgpt', 'manual']

function isWay(value: string | null): value is SetupReadWay {
  return WAYS.some((way) => way === value)
}

function isBot(value: string | null): value is HelpFillBot {
  return HELPFILL_BOTS.some((bot) => bot === value)
}

/**
 * Step 3, "How should CiteFox learn about <site>?" (panels 3a and 3b).
 * - The choose view: three ways and ONE primary button whose label follows the choice.
 * - "✦ Read my website" opens the working view (it runs on its own; Continue stays off
 *   until it is done, then the wizard moves on by itself).
 * - "Use my own ChatGPT" shows one prompt to copy and reads the pasted answer.
 * - "I'll type it myself" leaves every section empty.
 * The way and the chatbot are on the URL (`?way=…&paste=1&bot=…`).
 */
export function ReadStep({
  draft,
  onDraft,
  onBack,
  onContinue,
  busy,
  alert,
  announce,
  read,
  services,
  claudeAvailable,
  claudeReason,
  openLink = openInBrowser
}: ReadStepProps): JSX.Element {
  const groupName = useId()
  const [wayParam, setWayParam] = useQueryState('way')
  const [pasteParam, setPasteParam] = useQueryState('paste', { history: 'push' })
  const [botParam, setBotParam] = useQueryState('bot')
  const domain = normalizeDomain(draft.site.domain)
  const fallback: SetupReadWay = draft.readWay ?? (claudeAvailable === false ? 'chatgpt' : 'claude')
  const picked: SetupReadWay = isWay(wayParam) ? wayParam : fallback
  const way: SetupReadWay = picked === 'claude' && claudeAvailable === false ? 'chatgpt' : picked
  const pasting = way === 'chatgpt' && pasteParam === '1'
  const working = read.status === 'running' || read.status === 'failed'
  const pause = useClaudePause(read.status === 'failed', null)
  const site: HelpFillSetupSite = useMemo(() => {
    const country = draft.site.country === 'other' ? draft.site.countryCode : draft.site.country
    const language = draft.site.language === 'other' ? draft.site.languageCode : draft.site.language
    return {
      domain,
      brandNames: [],
      market: {
        country: normalizeCountry(country),
        language: normalizeLanguageTag(language),
        location: draft.site.location.trim() || null
      }
    }
  }, [domain, draft.site])
  const [help, helpActions] = useSetupHelp(services, site, pasting)
  const bot: HelpFillBot = isBot(botParam) ? botParam : (rememberedBot() ?? 'chatgpt')

  function choose(next: SetupReadWay): void {
    setWayParam(next)
  }

  function startRead(): void {
    onDraft((current) => ({ ...current, readWay: 'claude', readDone: false }))
    announce(`Reading ${domain}. This runs on its own.`)
    read.run()
  }

  function typeMyself(): void {
    onDraft((current) => ({ ...current, readWay: 'manual', readDone: true }))
    onContinue()
  }

  function switchToChatgpt(): void {
    read.abandon()
    setWayParam('chatgpt')
    setPasteParam('1')
  }

  function readAnswer(text: string): void {
    void helpActions.read(text).then((result) => {
      if (result === null) return
      if (result.counts.ready === 0) {
        announce('Nothing could be read from that answer. Paste the whole answer.')
        return
      }
      onDraft((current) => ({
        ...applyChatbotAnswer(current, result),
        readWay: 'chatgpt',
        readDone: true
      }))
      announce(`Read ${result.counts.ready} items from the answer.`)
      onContinue()
    })
  }

  if (working) {
    const failed = read.status === 'failed'
    // Only competitor searches left: Continue moves on, they still fill in (never block).
    const onlySearches = !failed && read.sectionsDone
    return (
      <StepPage
        kicker={stepKicker('read')}
        title={failed ? `Could not read ${domain}` : `Reading ${domain}…`}
        onBack={onBack}
        note={
          onlySearches
            ? 'Searches still running are added when they finish'
            : 'Continue unlocks when reading is done'
        }
        primary={{ label: 'Continue', onClick: read.finishNow, disabled: !onlySearches }}
        alert={alert}
      >
        {failed ? (
          <div className="panel-warn obs-failed" role="alert">
            <p className="ob-strong">
              <LinkedText text={read.error ?? ''} />
            </p>
            <div className="inline">
              {pause ? (
                <ClaudeWait pause={pause} look="link" className="obs-link" />
              ) : (
                <button type="button" className="obs-link" onClick={startRead}>
                  Try again
                </button>
              )}
              <button type="button" className="obs-link" onClick={switchToChatgpt}>
                Use my own ChatGPT
              </button>
              <button type="button" className="obs-link" onClick={typeMyself}>
                I’ll type it myself
              </button>
            </div>
          </div>
        ) : onlySearches ? (
          <WaitNote read={read} />
        ) : (
          <div className="obs-note" role="note">
            <UiIcon name="bulb" size={14} />
            <p>
              <strong>This runs on its own. You don’t need to do anything.</strong> Wait here, or
              use another app; we’ll move you to the next step when it’s done.
            </p>
          </div>
        )}
        <ReadProgress read={read} onRetry={read.retry} />
        {failed ? null : (
          <p className="hint">
            Usually 2–4 minutes. Taking too long?{' '}
            <button type="button" className="obs-link" onClick={switchToChatgpt}>
              Switch to my own ChatGPT
            </button>
          </p>
        )}
      </StepPage>
    )
  }

  if (pasting) {
    return (
      <StepPage
        kicker={stepKicker('read')}
        title={`Ask your own ChatGPT about ${domain}`}
        sub={
          <p>Copy one prompt, paste the whole answer back. CiteFox fills the next steps from it.</p>
        }
        onBack={() => setPasteParam(null)}
        note="Continue unlocks when the answer is read"
        primary={{
          label: 'Continue',
          onClick: onContinue,
          disabled: !draft.readDone || draft.readWay !== 'chatgpt' || busy
        }}
        alert={alert}
      >
        <section className="ob-card hf" aria-label="Your own ChatGPT">
          {usableDomain(domain) ? (
            <ChatbotSteps
              bot={bot}
              prompt={help.prompt}
              promptError={help.promptError}
              reading={help.reading}
              disabled={busy}
              tip="Pick a chatbot that browses the web, so it reads your site rather than guessing."
              pastePlaceholder={(name) => `Paste ${name}’s whole answer, all five sections…`}
              onBot={(next) => {
                rememberBot(next)
                setBotParam(next)
              }}
              onRetryPrompt={helpActions.reloadPrompt}
              onRead={readAnswer}
              openLink={openLink}
            />
          ) : (
            <p className="hint">Go back to step 1 and enter your website first.</p>
          )}
          {help.error ? (
            <p className="hf-hint hf-bad" role="alert">
              <LinkedText text={help.error} />
            </p>
          ) : null}
        </section>
      </StepPage>
    )
  }

  const noClaude = claudeAvailable === false
  const primary =
    draft.readDone && wayParam === null
      ? { label: 'Continue', onClick: onContinue }
      : way === 'claude'
        ? { label: 'Read my website', onClick: startRead, icon: 'sparkle' as const }
        : way === 'chatgpt'
          ? { label: 'Get the prompt', onClick: () => setPasteParam('1') }
          : { label: 'Continue with empty steps', onClick: typeMyself }
  const note =
    primary.label === 'Continue'
      ? 'Next: your brand and products'
      : way === 'claude'
        ? `Starts reading ${domain}`
        : way === 'chatgpt'
          ? 'Free, about 1 minute'
          : 'Each section still has ✦ Find more'

  return (
    <StepPage
      kicker={stepKicker('read')}
      title={`How should CiteFox learn about ${domain}?`}
      sub={<p>The next steps show what it found, filled in, for you to change and confirm.</p>}
      onBack={onBack}
      note={note}
      primary={{ ...primary, disabled: busy || (way === 'claude' && claudeAvailable === null) }}
      alert={alert}
    >
      {draft.readDone && read.status === 'done' ? (
        <OpenSearches live={read.live} onRetry={read.retry} />
      ) : null}
      {draft.readDone ? (
        <div className="panel-ok obs-done" role="status">
          <UiIcon name="check" size={14} />
          <p>
            Already filled in: {keptCount(draft, 'products')} products, {keptCount(draft, 'buyers')}{' '}
            buyers and {keptCount(draft, 'competitors')} competitors. Continue to check them, or
            pick a way to start again.
          </p>
        </div>
      ) : null}
      <div className="obs-ways" role="radiogroup" aria-label="How CiteFox learns about your site">
        <label className={`obs-way${way === 'claude' ? ' on' : ''}${noClaude ? ' off' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            checked={way === 'claude'}
            disabled={noClaude}
            onChange={() => choose('claude')}
          />
          <span className="obs-way-title">
            <span className="obs-spark" aria-hidden="true">
              <UiIcon name="sparkle" size={12} />
            </span>
            Read my website
          </span>
          <span className="obs-way-text">
            {noClaude
              ? `${claudeReason ?? 'No AI is set up.'} Use your own ChatGPT instead (free).`
              : 'CiteFox AI reads up to 12 pages and searches the web for competitors. About 2–4 min, on your AI plan.'}
          </span>
        </label>
        <label className={`obs-way${way === 'chatgpt' ? ' on' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            checked={way === 'chatgpt'}
            onChange={() => choose('chatgpt')}
          />
          <span className="obs-way-title">Use my own ChatGPT</span>
          <span className="obs-way-text">
            Copy one prompt, paste the answer back. Free, about 1 min.
          </span>
        </label>
        <label className={`obs-way${way === 'manual' ? ' on' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            checked={way === 'manual'}
            onChange={() => choose('manual')}
          />
          <span className="obs-way-title">I’ll type it myself</span>
          <span className="obs-way-text">Empty steps; each section still has ✦ Find more.</span>
        </label>
      </div>
    </StepPage>
  )
}

/**
 * Step 3 once only competitor searches are left: what it waits for and until when.
 * A "Try again" the user started is waited for; otherwise the step moves on by itself
 * at the soft deadline, and searches still open fill in later.
 */
function WaitNote({ read }: { read: SiteRead }): JSX.Element {
  const now = useNow(true)
  const waitingForRetry = retrying(read.live)
  const left = read.deadlineAt === null ? 0 : Math.max(0, read.deadlineAt - now)
  return (
    <div className="obs-note" role="note">
      <UiIcon name="bulb" size={14} />
      <p>
        {waitingForRetry ? (
          <>
            <strong>Waiting for the search you asked to try again.</strong> Continue to go on
            without it; what it finds is still added to your competitors.
          </>
        ) : (
          <>
            <strong>Still searching the web for competitors.</strong> Continue now, or wait
            {left > 0 ? `: CiteFox moves on by itself in ${formatElapsed(left)}` : ''}. What the
            searches find is added to your competitors when it comes in.
          </>
        )}
      </p>
    </div>
  )
}
