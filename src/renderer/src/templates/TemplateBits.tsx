import type { JSX } from 'react'
import type { GenerationTemplate, GenerationTemplateKind } from '@shared/domain'
import type { TemplateUsage } from '@shared/ipc'
import { formatDay, shortHash } from '../pageSetup/model'
import { usageLine } from './model'

export function TemplateStamp({
  template,
  hash
}: {
  template: GenerationTemplate
  hash: string
}): JSX.Element | null {
  if (!hash) return null
  const when = template.updatedAt
    ? `Edited ${formatDay(template.updatedAt)}`
    : template.isShipped
      ? `Shipped ${formatDay(template.createdAt)}`
      : `Created ${formatDay(template.createdAt)}`
  return (
    <details className="tpl-hash-details">
      <summary title={hash}>
        {when} · hash {shortHash(hash)}
      </summary>
      <p className="mono">{hash}</p>
    </details>
  )
}

export function UsageText({
  kind,
  usage
}: {
  kind: GenerationTemplateKind
  usage: TemplateUsage | undefined
}): JSX.Element {
  if (!usage) return <span className="faint tpl-when">Usage loading…</span>
  return <span className="faint tpl-when">{usageLine(kind, usage)}</span>
}
