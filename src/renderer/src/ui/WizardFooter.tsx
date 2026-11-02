import type { JSX, ReactNode } from 'react'
import { Button } from './Button'
import { UiIcon, type UiIconName } from './UiIcon'

/** The footer's one primary (fox) action. */
export interface WizardPrimary {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  /** Icon after the label. Default `arrow-right`; pass `null` for none. */
  icon?: UiIconName | null
}

export interface WizardFooterProps {
  /** Shows the white Back button when set. */
  onBack?: () => void
  backLabel?: string
  /** One-line cost note left of the primary, such as "118 keywords need 118–236 searches". */
  note?: ReactNode
  /** `warn` draws the note in warning colour with a warning icon (over budget). */
  noteTone?: 'neutral' | 'warn'
  primary: WizardPrimary
}

/**
 * The sticky wizard footer (Theme "Layouts", Keywords-Groups.png): Back (white)
 * on the left, a one-line cost note and the screen's one primary on the right.
 */
export function WizardFooter({
  onBack,
  backLabel = 'Back',
  note,
  noteTone = 'neutral',
  primary
}: WizardFooterProps): JSX.Element {
  const icon = primary.icon === undefined ? 'arrow-right' : primary.icon
  return (
    <footer className="ui-wizard-foot">
      {onBack ? (
        <Button variant="secondary" icon="arrow-left" onClick={onBack}>
          {backLabel}
        </Button>
      ) : (
        <span />
      )}
      <div className="ui-wizard-end">
        {note ? (
          <p
            className={`ui-wizard-note num${noteTone === 'warn' ? ' ui-wizard-note-warn' : ''}`}
            role="status"
          >
            {noteTone === 'warn' ? <UiIcon name="warning" size={14} /> : null}
            <span>{note}</span>
          </p>
        ) : null}
        <Button
          variant="primary"
          onClick={primary.onClick}
          disabled={primary.disabled}
          busy={primary.busy}
          {...(icon ? { iconEnd: icon } : {})}
        >
          {primary.label}
        </Button>
      </div>
    </footer>
  )
}
