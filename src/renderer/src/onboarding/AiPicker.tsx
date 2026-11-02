import { useId, type JSX } from 'react'
import type { AiCliProvider } from '@shared/domain'
import './steps/setup-steps.css'

const WAYS: readonly { provider: AiCliProvider; title: string; text: string }[] = [
  {
    provider: 'claude-code',
    title: 'Claude Code',
    text: 'Anthropic’s Claude, on your own Claude plan.'
  },
  {
    provider: 'codex',
    title: 'Codex',
    text: 'OpenAI’s Codex, on your own ChatGPT plan.'
  }
]

/**
 * The AI step's choice: which program on this computer does CiteFox's AI work.
 * Either one runs every AI feature; the choice is saved in Settings.
 */
export function AiPicker({
  value,
  disabled,
  onChange
}: {
  value: AiCliProvider
  disabled: boolean
  onChange: (provider: AiCliProvider) => void
}): JSX.Element {
  const name = useId()
  return (
    <div className="obs-ways obs-ways-2" role="radiogroup" aria-label="Which AI CiteFox uses">
      {WAYS.map((way) => (
        <label
          key={way.provider}
          className={`obs-way${value === way.provider ? ' on' : ''}`}
          data-testid={`ai-${way.provider}`}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            checked={value === way.provider}
            disabled={disabled}
            onChange={() => onChange(way.provider)}
          />
          <span className="obs-way-title">{way.title}</span>
          <span className="obs-way-text">{way.text}</span>
        </label>
      ))}
    </div>
  )
}
