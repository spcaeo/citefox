import type { JSX } from 'react'
import type { ClaudePauseInfo } from '@shared/ipc'
import { Button, LinkButton } from '../../ui'
import { apiKeyHash } from './screenLinks'
import './claudePause.css'

/**
 * In place of Try again while Claude Code is paused after a usage limit: a disabled
 * "Available again Sunday, Nov 1 at 7:00 AM", plus "Use an API key instead" when
 * there is no Anthropic key yet. `look="link"` matches the setup's text links.
 */
export function ClaudeWait({
  pause,
  look = 'button',
  className
}: {
  pause: ClaudePauseInfo
  look?: 'button' | 'link'
  className?: string
}): JSX.Element {
  const label = `Available again ${pause.availableAgain}`
  const href = apiKeyHash()
  if (look === 'link') {
    return (
      <>
        <button type="button" className={className} disabled data-testid="claude-wait">
          {label}
        </button>
        {pause.hasApiKey ? null : (
          <a className={className} href={href}>
            Use an API key instead
          </a>
        )}
      </>
    )
  }
  return (
    <span className="claude-wait">
      <Button size="sm" variant="secondary" icon="pause" disabled data-testid="claude-wait">
        {label}
      </Button>
      {pause.hasApiKey ? null : (
        <LinkButton size="sm" variant="text" icon="bolt" href={href}>
          Use an API key instead
        </LinkButton>
      )}
    </span>
  )
}
