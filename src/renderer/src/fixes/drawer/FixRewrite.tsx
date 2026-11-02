import { useId, type JSX } from 'react'
import type { HelpFillResult } from '@shared/ipc'
import type { PromptOption } from '../../progress/model'
import { HelpFill, type HelpFillBot, type HelpFillSource, type HelpFillWay } from '../../ui'

/**
 * The fix drawer's "✦ Help me fill this" (HelpFill.dc.html panel 5): the new
 * section for one question the fix should help. "✦ Draft it for me" runs the fix
 * assists from the evidence; "Rewrite with my ChatGPT" copies a prompt with the
 * question, what Google's AI Overview cited for it and what the page says now. The
 * answer becomes the fix's draft in "What changed", to edit before Log fix.
 * The question is the first one ticked, or the one picked here (`fix.for`).
 */
export function FixRewrite({
  projectId,
  pageId,
  questions,
  forPromptId,
  onFor,
  source,
  way,
  bot,
  onWay,
  onBot,
  disabled,
  onText,
  openLink
}: {
  projectId: string
  /** The page or topic of the fix; null until one is picked. */
  pageId: string | null
  /** The ticked questions, in order. */
  questions: readonly PromptOption[]
  forPromptId: string | null
  onFor: (promptId: string) => void
  source: HelpFillSource
  way: HelpFillWay | null
  bot: HelpFillBot | null
  onWay: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
  disabled: boolean
  onText: (text: string) => void
  openLink?: ((url: string) => void) | undefined
}): JSX.Element {
  const forId = useId()
  if (pageId === null) {
    return <p className="muted">Pick the page or topic first.</p>
  }
  if (questions.length === 0) {
    return (
      <p className="muted" data-testid="fxd-help-pick">
        Tick the question it should help, and CiteFox writes the section from what Google cites for
        it.
      </p>
    )
  }
  const question = questions.find((item) => item.id === forPromptId) ?? questions[0]
  if (question === undefined) return <></>
  return (
    <div className="fxd-help" data-testid="fxd-help">
      {questions.length > 1 ? (
        <div className="fxd-help-for">
          <label className="ui-drawer-label" htmlFor={forId}>
            Write it for
          </label>
          <select
            id={forId}
            className="ui-input ui-input-sm"
            value={question.id}
            disabled={disabled}
            onChange={(event) => onFor(event.target.value)}
          >
            {questions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.text || item.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="fxd-help-for faint">For “{question.text || question.label}”</p>
      )}
      <HelpFill
        kind="fix"
        projectId={projectId}
        scope={{ pageId, promptId: question.id }}
        source={source}
        way={way}
        onWay={onWay}
        bot={bot}
        onBot={onBot}
        disabled={disabled}
        ways={{
          describe: {
            title: 'Draft it for me',
            text: 'CiteFox writes the new section from the evidence.'
          },
          chatbot: {
            title: 'Rewrite with my ChatGPT',
            text: 'The prompt includes the question, what Google cited and your current section.'
          }
        }}
        describe={{
          label: 'Anything CiteFox AI should keep or change? (optional)',
          placeholder: 'For example: mention that the gateway shut down in June 2025.',
          buttonLabel: () => 'Draft it for me'
        }}
        chatbot={{
          pastePlaceholder: (name) => `Paste the section ${name} wrote…`,
          tip: 'It becomes the draft below. Edit it before you log the fix.'
        }}
        onRows={(result: HelpFillResult) => {
          if (result.text) onText(result.text)
        }}
        {...(openLink ? { openLink } : {})}
        testId="fxd-hf"
      />
    </div>
  )
}
