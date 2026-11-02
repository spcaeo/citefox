import type { JSX } from 'react'
import { Button, LinkButton } from '../Button'
import type { UiIconName } from '../UiIcon'

/** One button of the pair: a link (`href`, a URL state) or an action. */
export interface HelpFillPairAction {
  label: string
  href?: string
  onClick?: () => void
}

/**
 * The empty state's two buttons (HelpFill.dc.html panel 6, "No competitors yet"):
 * the list's green primary ("Add competitor") and a white "✦ Help me find them"
 * that opens the helper for that kind. Every list that asks the user to add
 * things uses this pair, so the wording and the look stay the same.
 */
export function HelpFillPair({
  primary,
  help,
  icon = 'plus'
}: {
  primary: HelpFillPairAction
  help: HelpFillPairAction
  /** The primary's icon. Default `plus`. */
  icon?: UiIconName
}): JSX.Element {
  return (
    <div className="hf-pair">
      <PairButton action={primary} variant="primary" icon={icon} />
      <PairButton action={help} variant="secondary" icon="sparkle" className="hf-spark-btn" />
    </div>
  )
}

function PairButton({
  action,
  variant,
  icon,
  className
}: {
  action: HelpFillPairAction
  variant: 'primary' | 'secondary'
  icon: UiIconName
  className?: string
}): JSX.Element {
  if (action.href !== undefined) {
    return (
      <LinkButton
        href={action.href}
        variant={variant}
        size="sm"
        icon={icon}
        {...(className ? { className } : {})}
        {...(action.onClick ? { onClick: action.onClick } : {})}
      >
        {action.label}
      </LinkButton>
    )
  }
  return (
    <Button variant={variant} size="sm" icon={icon} className={className} onClick={action.onClick}>
      {action.label}
    </Button>
  )
}
