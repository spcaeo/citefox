import { useEffect, useRef, type JSX } from 'react'
import type { HelpFillBot } from '@shared/helpfill'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { ChatbotSteps } from './ChatbotSteps'
import { DescribeForm } from './DescribeForm'
import { openInBrowser } from './source'
import { SummaryBanner } from './SummaryBanner'
import type { HelpFillProps } from './types'
import { rememberBot, rememberedBot } from './url'
import { useHelpFill } from './useHelpFill'
import { WayCards } from './WayCards'

/**
 * "✦ Help me fill this" (Docs/HELPFILL.md, HelpFill.dc.html panels 1–3): the one
 * helper every list uses. Two choice cards: Describe it (in-app Claude drafts
 * rows from the user's sentence, cost shown first) and Use your own ChatGPT (pick
 * a chatbot, copy one prompt that already holds the project's context, paste the
 * answer back). Main merges near-duplicates and sets aside rows that name the
 * brand; the banner says what happened, and `onRows` hands the rows to the
 * place's own review UI. Nothing is saved here.
 *
 * The way and the bot are on the URL (`help=`, `bot=`): the place passes them in
 * and writes them back (`useHelpFillUrl` on a screen, `setDrawerParams` in a drawer).
 */
export function HelpFill({
  kind,
  projectId,
  scope,
  items,
  source,
  way: wayParam,
  onWay,
  bot: botParam,
  onBot,
  describe,
  chatbot,
  ways,
  only,
  banner = true,
  onRows,
  disabled = false,
  openLink = openInBrowser,
  testId = 'hf'
}: HelpFillProps): JSX.Element {
  const [live, liveActions] = useHelpFill(
    source,
    kind,
    projectId,
    scope,
    only ?? wayParam,
    chatbot?.count ?? null,
    items
  )
  const { way } = live
  const available = live.estimate?.available ?? null
  const bot: HelpFillBot = botParam ?? rememberedBot() ?? 'chatgpt'
  const noun = live.result?.result.noun ?? nounFallback(describe.buttonLabel)
  // After a usage limit, Write again would only fail: it waits for the reset instead.
  const pause = useClaudePause(Boolean(live.error), projectId)

  // A pasted link that names Describe for a project without a key opens the free way instead.
  const corrected = useRef(false)
  useEffect(() => {
    if (corrected.current || only !== undefined) return
    if (available !== false || wayParam !== 'describe') return
    corrected.current = true
    onWay('chatbot')
  }, [available, wayParam, onWay, only])

  return (
    <div className="hf" data-testid={testId}>
      {only === undefined ? (
        <WayCards
          way={way}
          noun={noun[1]}
          available={available}
          reason={live.estimate?.reason ?? null}
          disabled={disabled}
          copy={ways}
          onWay={onWay}
        />
      ) : null}
      {only === 'describe' && available === false ? (
        <p className="hf-hint" role="status" data-testid={`${testId}-no-key`}>
          {live.estimate?.reason ?? 'Needs CiteFox AI connected.'} Add one in Connections to use
          this.
        </p>
      ) : null}
      {way === 'describe' && !(only === 'describe' && available === false) ? (
        <DescribeForm
          copy={describe}
          noun={noun}
          costText={live.estimate?.costText ?? null}
          busy={live.busy === 'describe'}
          disabled={disabled || pause !== null}
          hasResult={live.result?.way === 'describe'}
          onWrite={(sentence, count) => {
            void liveActions.describe(sentence, count).then((result) => {
              if (result) onRows(result, 'describe')
            })
          }}
        />
      ) : null}
      {way === 'chatbot' ? (
        <ChatbotSteps
          bot={bot}
          prompt={live.prompt}
          promptError={live.promptError}
          reading={live.busy === 'read'}
          disabled={disabled}
          tip={chatbot?.tip}
          {...(chatbot?.pastePlaceholder ? { pastePlaceholder: chatbot.pastePlaceholder } : {})}
          onBot={(next) => {
            rememberBot(next)
            onBot(next)
          }}
          onRetryPrompt={liveActions.reloadPrompt}
          onRead={(text) => {
            void liveActions.read(text).then((result) => {
              if (result) onRows(result, 'chatbot')
            })
          }}
          openLink={openLink}
        />
      ) : null}
      {live.error ? (
        <p className="hf-hint hf-bad" role="alert">
          <LinkedText text={live.error} />
          {pause ? (
            <>
              {' '}
              <ClaudeWait pause={pause} />
            </>
          ) : null}
        </p>
      ) : null}
      {banner && live.result && live.result.way === way ? (
        <SummaryBanner result={live.result.result} testId={`${testId}-summary`} />
      ) : null}
    </div>
  )
}

/** "question"/"questions" before the first answer names the noun: from "Write 10 questions". */
function nounFallback(label: (count: number) => string): readonly [string, string] {
  const plural = label(2).split(/\s+/u).pop() ?? 'rows'
  const singular = label(1).split(/\s+/u).pop() ?? 'row'
  return [singular, plural]
}
