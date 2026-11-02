import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react'
import type { HelpFillSetupSite } from '@shared/ipc'
import { Button, openInBrowser, rememberBot, rememberedBot, type HelpFillBot } from '../../ui'
import { ChatbotSteps } from '../../ui/HelpFill/ChatbotSteps'
import type { FillState } from '../useFillFromWebsite'
import { FoundCards } from './FoundCards'
import { draftFromAnswer, type SetupPlan } from './model'
import { QuestionsPlan } from './QuestionsPlan'
import { SetupWays } from './SetupWays'
import type { SetupHelpSource } from './source'
import type { SetupUrlState } from './url'
import { usableDomain, useSetupHelp } from './useSetupHelp'
import './setupHelp.css'

/**
 * "How should we set up example.com?" (HelpFill.dc.html panel 4): New project's
 * "✦ Help me fill this". Three ways: Read my website (`projects:fillFromWebsite`,
 * its cost shown first), Use my own ChatGPT (one prompt with five sections, the
 * answer pasted back) and I'll fill it in (the form). The website read and the
 * answer both land in the same Fill card, which the host shows; the answer's
 * questions become a topics plan here. Nothing is saved before Create project.
 *
 * The way and the bot are on the URL (`help=`, `bot=`); the host passes them in.
 */
export function SetupHelp({
  site,
  source,
  url,
  fill,
  onReadWebsite,
  websiteNote,
  plan,
  onPlan,
  disabled = false,
  connectClaude = false,
  savedWhen = 'when you create the project',
  headingAs: Heading = 'h2',
  openLink = openInBrowser
}: {
  site: HelpFillSetupSite
  source: SetupHelpSource
  url: SetupUrlState
  fill: FillState
  /** Runs "Read my website" (onboarding checks Claude first). */
  onReadWebsite: () => void
  /** Under the website way's button: onboarding's Claude check. */
  websiteNote?: ReactNode
  plan: SetupPlan | null
  onPlan: (plan: SetupPlan | null) => void
  disabled?: boolean
  /** Onboarding: "Read my website" sets Claude up first when it is missing, so that way stays open. */
  connectClaude?: boolean
  /** When the ticked questions are saved: Create project, or onboarding's Continue. */
  savedWhen?: string
  headingAs?: 'h2' | 'h3'
  /** Test seam; the default is the app's safe path. */
  openLink?: (url: string) => void
}): JSX.Element {
  const headId = useId()
  const planRef = useRef<HTMLElement>(null)
  const [help, actions] = useSetupHelp(source, site, url.way === 'chatbot')
  const estimated = help.estimate?.available ?? null
  const available = connectClaude && estimated !== null ? true : estimated
  const way = url.way ?? (available === null ? null : available ? 'website' : 'chatbot')
  const bot: HelpFillBot = url.bot ?? rememberedBot() ?? 'chatgpt'
  const domain = site.domain.trim()

  // A pasted link that names the website way with no Claude key opens the free way instead.
  const corrected = useRef(false)
  const { onWay } = url
  useEffect(() => {
    if (corrected.current || available !== false || url.way !== 'website') return
    corrected.current = true
    onWay('chatbot')
  }, [available, url.way, onWay])

  function read(text: string): void {
    void actions.read(text).then((result) => {
      if (result === null || result.counts.ready === 0) return
      const draft = draftFromAnswer(result, domain)
      fill.adopt(draft.fill)
      onPlan(draft.plan.topics.length > 0 || draft.plan.markets.length > 0 ? draft.plan : null)
    })
  }

  return (
    <section className="hf su" aria-labelledby={headId} data-testid="su">
      <div className="su-head">
        <Heading className="su-title" id={headId}>
          How should we set up {domain.length > 0 ? domain : 'your site'}?
        </Heading>
        <p className="hf-hint">Pick the easiest way. You check everything before it’s saved.</p>
      </div>
      <SetupWays
        way={way}
        domain={domain}
        available={available}
        costText={estimated ? (help.estimate?.costText ?? null) : null}
        reason={help.estimate?.reason ?? null}
        disabled={disabled}
        onWay={url.onWay}
      />
      {way === 'website' ? (
        <div className="su-website" data-testid="su-website">
          <div className="su-website-row">
            <Button
              icon="sparkle"
              className="hf-spark-btn"
              busy={fill.filling}
              disabled={disabled || !usableDomain(domain)}
              onClick={onReadWebsite}
            >
              Read my website
            </Button>
            <span className="hf-hint">
              {usableDomain(domain)
                ? 'Reads the site, then suggests products, buyers, competitors and a default market.'
                : 'Enter your website’s domain above first.'}
            </span>
          </div>
          {websiteNote}
        </div>
      ) : null}
      {way === 'chatbot' && !usableDomain(domain) ? (
        <p className="hf-hint" data-testid="su-no-domain">
          Enter your website’s domain above, and the prompt is written for it.
        </p>
      ) : null}
      {way === 'chatbot' && usableDomain(domain) ? (
        <ChatbotSteps
          bot={bot}
          prompt={help.prompt}
          promptError={help.promptError}
          reading={help.reading}
          disabled={disabled}
          tip="Pick a chatbot that browses the web, so it reads your site rather than guessing."
          pastePlaceholder={(name) => `Paste ${name}’s whole answer, all five sections…`}
          onBot={(next) => {
            rememberBot(next)
            url.onBot(next)
          }}
          onRetryPrompt={actions.reloadPrompt}
          onRead={read}
          openLink={openLink}
        />
      ) : null}
      {help.error ? (
        <p className="hf-hint hf-bad" role="alert">
          {help.error}
        </p>
      ) : null}
      {way === 'chatbot' && help.result ? (
        <FoundCards
          result={help.result}
          fill={fill.origin === 'chatbot' ? fill.result : null}
          plan={plan}
          onQuestions={() => {
            planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            planRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}
      {plan !== null && plan.topics.length > 0 ? (
        <QuestionsPlan
          ref={planRef}
          plan={plan}
          disabled={disabled}
          savedWhen={savedWhen}
          onPlan={onPlan}
        />
      ) : null}
    </section>
  )
}
