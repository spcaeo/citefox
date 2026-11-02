import type { JSX } from 'react'
import type { OnboardingCheckupResult } from '../claudeLogin'
import type { OnboardingClient } from '../client'
import { ClaudeScreen } from '../ClaudeScreen'
import { stepKicker } from '../setupSteps'
import { normalizeDomain } from '../validate'
import type { SetupStepProps } from './types'
import './setup-steps.css'

export interface ClaudeStepProps extends SetupStepProps {
  client: OnboardingClient
  onChecked: (result: OnboardingCheckupResult) => void
  /** Saves and tests an Anthropic key: an error message, or null when it was stored. */
  onAnthropic: (secret: string) => Promise<{ error: string | null; hint: string | null }>
}

/**
 * Step 2, "Let your AI do the reading and writing": the choice of Claude Code or
 * Codex, its checkup and the Anthropic key (ClaudeScreen), plus "Neither? Skip and
 * paste into your own ChatGPT instead", which makes step 3 open on the ChatGPT way;
 * every section card then offers its prompt to copy and paste back.
 */
export function ClaudeStep({
  draft,
  onDraft,
  onBack,
  onContinue,
  announce,
  client,
  onChecked,
  onAnthropic
}: ClaudeStepProps): JSX.Element {
  const domain = normalizeDomain(draft.site.domain)

  function skip(): void {
    onDraft((current) => ({ ...current, readWay: current.readDone ? current.readWay : 'chatgpt' }))
    announce('AI step skipped. Each AI step gives you a prompt for your own ChatGPT.')
    onContinue()
  }

  return (
    <ClaudeScreen
      client={client}
      onAnnounce={announce}
      onBack={onBack}
      onContinue={onContinue}
      onChecked={onChecked}
      onAnthropic={onAnthropic}
      kicker={stepKicker('claude')}
      title="Let your AI do the reading and writing"
      lead={
        <p>
          Claude Code or Codex reads your site and drafts your brand, buyers, competitors and
          questions. You check every answer.
        </p>
      }
      note={domain.length > 0 ? `Next: read ${domain}` : 'Next: read your site'}
      after={
        <p className="hint obs-skip" data-testid="claude-skip">
          No Claude Code or Codex?{' '}
          <button type="button" className="obs-link" onClick={skip}>
            Skip and use your own ChatGPT instead
          </button>
          : every AI step then gives you a prompt to copy and paste back. Free.
        </p>
      }
    />
  )
}
