import type { JSX } from 'react'
import type { ClaudeStatus } from '@shared/ipc'
import { claudeChipModel } from './claudeChip'
import { usePermissions } from './permissionsContext'

/**
 * A small line that says whether CiteFox AI works ("CiteFox AI · connected").
 * `named` (Status only) names the connection, plan and model instead
 * ("Claude Code · connected · Claude Max · Sonnet 4.5"). Phrasing content only,
 * so it fits inside a menu footer `<p>`. `setupHref` adds a "Set up" link when
 * the connection needs a step.
 */
export function ClaudeStatusChip({
  status,
  checking = false,
  setupHref,
  size = 'md',
  className,
  named = false
}: {
  status: ClaudeStatus | null
  checking?: boolean
  setupHref?: string
  size?: 'sm' | 'md'
  className?: string
  /** True on Status: name the provider, plan and model. */
  named?: boolean
}): JSX.Element {
  const model = claudeChipModel(status, checking, named)
  const needsStep = !checking && status !== null && status.state !== 'ready'
  return (
    <span
      className={[
        'ui-claude',
        `ui-claude-${model.tone}`,
        size === 'sm' ? 'ui-claude-sm' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-claude-state={checking ? 'checking' : (status?.state ?? 'loading')}
    >
      <span className="ui-claude-dot" aria-hidden="true" />
      <span className="sr-only">{model.label}</span>
      <span className="ui-claude-text" aria-hidden="true">
        {model.parts.map((part, index) => (
          <span key={`${index}:${part}`} className={index === 0 ? 'ui-claude-name' : undefined}>
            {index > 0 ? ` · ${part}` : part}
          </span>
        ))}
      </span>
      {needsStep && setupHref ? (
        <a className="ui-claude-link" href={setupHref}>
          Set up
        </a>
      ) : null}
    </span>
  )
}

/** {@link ClaudeStatusChip} fed by the app's permissions provider. Renders nothing outside one. */
export function ClaudeStatusLine({
  setupHref,
  size,
  className,
  named
}: {
  setupHref?: string
  size?: 'sm' | 'md'
  className?: string
  named?: boolean
}): JSX.Element | null {
  const permissions = usePermissions()
  if (permissions === null) return null
  return (
    <ClaudeStatusChip
      status={permissions.claude}
      checking={permissions.checking}
      {...(setupHref ? { setupHref } : {})}
      {...(size ? { size } : {})}
      {...(className ? { className } : {})}
      {...(named ? { named } : {})}
    />
  )
}
