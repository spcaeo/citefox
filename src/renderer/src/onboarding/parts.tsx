import type { JSX } from 'react'
import { Icon, type IconName } from '../components/Icon'

/** A field's error line, tied to its input with `aria-describedby`. Used across the app. */
export function FieldError({ id, children }: { id: string; children: string }): JSX.Element {
  return (
    <p className="field-error" id={id} role="alert">
      <Icon name="warning" size="chev" />
      {children}
    </p>
  )
}

export function PanelIcon({
  name,
  tone
}: {
  name: IconName
  tone: 'ok' | 'warn' | 'muted'
}): JSX.Element {
  const className = tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : 'muted'
  return (
    <span className={`icon-gap ${className}`}>
      <Icon name={name} size="nav" strong={tone === 'ok'} />
    </span>
  )
}
