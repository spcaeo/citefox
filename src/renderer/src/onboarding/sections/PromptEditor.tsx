import { useCallback, useEffect, useId, useState, type JSX } from 'react'
import type { SetupSectionPrompt } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { Button, IconButton } from '../../ui'
import { useCopyFeedback } from '../../ui/useCopyFeedback'
import { chatbotText } from './useSectionAi'

/** Rows for the prompt box: wrapped lines counted at about 90 characters, 5 to 14. */
function promptRows(text: string): number {
  const lines = text
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 90)), 0)
  return Math.min(14, Math.max(5, lines + 1))
}

/**
 * ✎ Edit the prompt (mock-up panel 6): the exact prompt for this section in
 * a code-font box the user can change. ✦ Run again saves the edit for the
 * section's later runs and runs it; Reset goes back to the default; Copy for
 * my ChatGPT copies it with the reply line. Without Claude, Run again becomes
 * the ChatGPT way with the edited prompt.
 */
export function PromptEditor({
  saved,
  costText,
  available,
  busy,
  loadPrompt,
  onRun,
  onReset,
  onChatbot,
  onClose
}: {
  /** The user's saved edit for this section, or null for the default. */
  saved: string | null
  costText: string
  available: boolean
  busy: boolean
  loadPrompt: () => Promise<SetupSectionPrompt>
  /** `edited` is false when the text is the default prompt (nothing to save). */
  onRun: (prompt: string, edited: boolean) => void
  onReset: () => void
  /** Opens "Your own ChatGPT" with this text. */
  onChatbot: (prompt: string) => void
  onClose: () => void
}): JSX.Element {
  const boxId = useId()
  const [prompt, setPrompt] = useState<SetupSectionPrompt | null>(null)
  const [text, setText] = useState(saved ?? '')
  const [loadError, setLoadError] = useState<string | null>(null)
  const copy = useCopyFeedback(prompt ? chatbotText(prompt, text) : text)

  const load = useCallback(() => {
    loadPrompt()
      .then((next) => {
        setLoadError(null)
        setPrompt(next)
        setText((typed) => (typed.length > 0 ? typed : next.prompt))
      })
      .catch((cause: unknown) => {
        setLoadError(errorText(cause, 'CiteFox could not write the prompt.', { sentence: true }))
      })
  }, [loadPrompt])

  useEffect(() => {
    load()
    // Load once when the editor opens; later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = prompt !== null && text.trim().length > 0
  const edited = prompt !== null && text.trim() !== prompt.prompt.trim()
  const cost = prompt?.webSearch && !/web/i.test(costText) ? `${costText} · web search` : costText

  return (
    <div className="osc-panel osc-prompt" data-testid="prompt-editor">
      <div className="osc-panel-head">
        <label htmlFor={boxId} className="osc-panel-title">
          ✎ The prompt CiteFox AI uses for this section
        </label>
        <span className="osc-hint">· change it, then run again</span>
        <span className="osc-grow" />
        <IconButton icon="x" size="sm" label="Close the prompt" onClick={onClose} />
      </div>
      {loadError ? (
        <p className="osc-hint osc-bad" role="alert">
          {loadError}{' '}
          <button
            type="button"
            className="osc-link"
            onClick={() => {
              setLoadError(null)
              load()
            }}
          >
            Try again
          </button>
        </p>
      ) : (
        <textarea
          id={boxId}
          className="ui-input osc-code"
          rows={promptRows(text)}
          value={prompt === null && text.length === 0 ? '' : text}
          placeholder={prompt === null ? 'Writing the prompt…' : ''}
          aria-busy={prompt === null || undefined}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="osc-row">
        {available ? (
          <Button
            size="sm"
            icon="sparkle"
            busy={busy}
            busyLabel="Running…"
            disabled={!ready}
            onClick={() => onRun(text.trim(), edited)}
          >
            Run again
          </Button>
        ) : (
          <Button size="sm" disabled={!ready} onClick={() => onChatbot(text.trim())}>
            Use my own ChatGPT
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy || prompt === null || (!edited && saved === null)}
          onClick={() => {
            if (prompt) setText(prompt.prompt)
            onReset()
          }}
        >
          Reset
        </Button>
        <Button
          size="sm"
          icon={copy.state === 'copied' ? 'check' : undefined}
          disabled={!ready}
          onClick={copy.copy}
        >
          {copy.state === 'copied' ? 'Copied' : 'Copy for my ChatGPT'}
        </Button>
        <span className="osc-grow" />
        <span className="osc-hint">{available ? cost : 'No AI is connected'}</span>
      </div>
    </div>
  )
}
