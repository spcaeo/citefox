import { useMemo, type JSX, type ReactNode } from 'react'
import { openInBrowser, SummaryBanner } from '../../../ui'
// The kit's own cards and steps, so this reads and words like Add questions → ✦ Help me write.
import { ChatbotSteps } from '../../../ui/HelpFill/ChatbotSteps'
import { WayCards } from '../../../ui/HelpFill/WayCards'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'
import { promptWithProblem } from '../utils/answer'

/**
 * "A buyer problem" with the ✦ Help me fill look (HelpFill.dc.html panel 7): two
 * choice cards. Describe it is the box as before (the footer's Write questions runs
 * the dialog's own generator). Use your own ChatGPT copies one prompt that holds the
 * project's context, the problem typed (optional) and the reply columns; the pasted
 * answer becomes the preview (topic name, questions with stage, target pages), which
 * Review questions and Target pages then show. Nothing is a topic until Create topic.
 */
export function ProblemHelp({
  state,
  actions,
  disabled,
  situation,
  openLink = openInBrowser
}: {
  state: NewTopicState
  actions: NewTopicActions
  disabled: boolean
  /** The buyer's situation box, optional or not. */
  situation: (optional: boolean) => ReactNode
  openLink?: (url: string) => void
}): JSX.Element {
  const { help } = state
  const prompt = useMemo(
    () =>
      help.prompt === null
        ? null
        : { ...help.prompt, prompt: promptWithProblem(help.prompt.prompt, state.situation) },
    [help.prompt, state.situation]
  )
  return (
    <div className="hf nt-help" data-testid="nt-help">
      <WayCards
        way={help.way}
        noun="questions"
        available={help.available}
        reason={help.reason}
        disabled={disabled}
        onWay={actions.help.setWay}
      />
      {help.way === 'describe' ? situation(false) : null}
      {help.way === 'chatbot' ? (
        <>
          {situation(true)}
          <ChatbotSteps
            bot={help.bot}
            prompt={prompt}
            promptError={help.promptError}
            reading={help.reading}
            disabled={disabled}
            tip="One topic: its name, the questions with their stage, and the page for each."
            onBot={actions.help.setBot}
            onRetryPrompt={actions.help.reloadPrompt}
            onRead={(text) => void actions.help.read(text)}
            openLink={openLink}
          />
        </>
      ) : null}
      {help.error ? (
        <p className="hf-hint hf-bad" role="alert">
          {help.error}
        </p>
      ) : null}
      {help.result !== null && help.way === 'chatbot' ? (
        <SummaryBanner result={help.result} testId="nt-help-summary" />
      ) : null}
    </div>
  )
}
