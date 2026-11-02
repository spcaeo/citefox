import { useId, useState, type JSX, type ReactNode } from 'react'
import { chatbotOpen, HELPFILL_BOT_SPECS, HELPFILL_BOTS, type HelpFillBot } from '@shared/helpfill'
import { HELPFILL_PASTE_MAX, type HelpFillPrompt } from '@shared/ipc'
import { copyText } from '../../components/clipboard'
import { announce } from '../announce'
import { Button } from '../Button'
import { IconButton } from '../IconButton'
import { UiIcon } from '../UiIcon'
import { useCopyFeedback } from '../useCopyFeedback'

/**
 * "Use your own ChatGPT" (panels 2 and 3), in three numbered steps: pick a
 * chatbot, send it the prompt (Copy, Copy prompt, Open <bot> ↗), then paste its
 * answer and read it. Open fills the prompt in when the bot reads `?q=` and the
 * link stays short; otherwise it copies the prompt and opens the bot's home page.
 */
export function ChatbotSteps({
  bot,
  prompt,
  promptError,
  reading,
  disabled,
  tip,
  pastePlaceholder,
  onBot,
  onRetryPrompt,
  onRead,
  openLink
}: {
  bot: HelpFillBot
  prompt: HelpFillPrompt | null
  promptError: string | null
  reading: boolean
  disabled: boolean
  tip?: ReactNode
  pastePlaceholder?: (botName: string) => string
  onBot: (bot: HelpFillBot) => void
  onRetryPrompt: () => void
  onRead: (text: string) => void
  openLink: (url: string) => void
}): JSX.Element {
  const pasteId = useId()
  const pickId = useId()
  const sendId = useId()
  const [answer, setAnswer] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const name = HELPFILL_BOT_SPECS[bot].name
  const text = prompt?.prompt ?? ''
  const boxCopy = useCopyFeedback(text)
  const buttonCopy = useCopyFeedback(text)

  function open(): void {
    if (text.length === 0) return
    const plan = chatbotOpen(bot, text)
    if (plan.prefilled) {
      openLink(plan.url)
      setOpened(`Opened ${name} with the prompt filled in.`)
      return
    }
    void copyText(text).then((ok) => {
      openLink(plan.url)
      const said = ok
        ? `Prompt copied. Paste it into ${name}.`
        : `Opened ${name}. Copy the prompt above and paste it there.`
      setOpened(said)
      announce(said)
    })
  }

  return (
    <div className="hf-steps" data-testid="hf-chatbot">
      <div className="hf-step">
        <p className="hf-label" id={pickId}>
          <span className="hf-num" aria-hidden="true">
            1
          </span>
          Which chatbot do you use?
        </p>
        <div className="hf-bots" role="radiogroup" aria-labelledby={pickId}>
          {HELPFILL_BOTS.map((id) => {
            const spec = HELPFILL_BOT_SPECS[id]
            return (
              <label key={id} className={`hf-bot${bot === id ? ' on' : ''}`}>
                <input
                  type="radio"
                  className="sr-only"
                  name={pickId}
                  checked={bot === id}
                  disabled={disabled}
                  onChange={() => {
                    onBot(id)
                    setOpened(null)
                  }}
                />
                <span className={`hf-mark hf-mark-${id}`} aria-hidden="true">
                  {spec.initial}
                </span>
                <span className="hf-bot-name">{spec.name}</span>
              </label>
            )
          })}
        </div>
      </div>

      <div className="hf-step">
        <p className="hf-label" id={sendId}>
          <span className="hf-num" aria-hidden="true">
            2
          </span>
          Send it this prompt
        </p>
        {promptError ? (
          <p className="hf-hint hf-bad" role="alert">
            {promptError}{' '}
            <button type="button" className="hf-link" onClick={onRetryPrompt}>
              Try again
            </button>
          </p>
        ) : (
          <div className="hf-code" data-testid="hf-prompt">
            <pre tabIndex={0} aria-labelledby={sendId} aria-busy={prompt === null || undefined}>
              {prompt === null ? 'Writing the prompt…' : text}
            </pre>
            <button
              type="button"
              className={`hf-code-copy${boxCopy.state === 'copied' ? ' done' : ''}`}
              aria-label={boxCopy.state === 'copied' ? 'Copied' : 'Copy the prompt'}
              disabled={prompt === null}
              onClick={boxCopy.copy}
            >
              <UiIcon name={boxCopy.state === 'copied' ? 'check' : 'copy'} size={14} />
            </button>
          </div>
        )}
        <div className="hf-row">
          <IconButton
            size="sm"
            tip
            icon={buttonCopy.state === 'copied' ? 'check' : 'copy'}
            label={buttonCopy.state === 'copied' ? 'Copied' : 'Copy prompt'}
            className={buttonCopy.state === 'copied' ? 'hf-copied' : undefined}
            disabled={disabled || prompt === null}
            onClick={buttonCopy.copy}
            data-testid="hf-copy-prompt"
          />
          <Button
            variant="secondary"
            size="sm"
            iconEnd="external"
            disabled={disabled || prompt === null}
            onClick={open}
            data-testid="hf-open-bot"
          >
            Open {name}
          </Button>
          <span className="hf-hint hf-grow hf-right" role="status">
            {opened ?? 'Opens with the prompt filled in when it fits; otherwise copy and paste.'}
          </span>
        </div>
      </div>

      <div className="hf-step">
        <p className="hf-label">
          <span className="hf-num" aria-hidden="true">
            3
          </span>
          <label htmlFor={pasteId}>Paste its answer below</label>
        </p>
        <textarea
          id={pasteId}
          className="ui-input hf-box hf-paste"
          rows={4}
          value={answer}
          maxLength={HELPFILL_PASTE_MAX}
          placeholder={pastePlaceholder?.(name) ?? `Paste the CSV, table or list ${name} gave you…`}
          disabled={disabled || reading}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <div className="hf-row">
          <span className="hf-hint hf-grow">
            {tip ?? 'CSV, a table or a plain list: all read the same.'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            busy={reading}
            busyLabel="Reading…"
            disabled={disabled || reading || answer.trim().length === 0}
            onClick={() => onRead(answer)}
            data-testid="hf-read"
          >
            Read the answer
          </Button>
        </div>
      </div>
    </div>
  )
}
