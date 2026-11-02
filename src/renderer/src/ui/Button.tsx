import {
  forwardRef,
  type ButtonHTMLAttributes,
  type JSX,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode
} from 'react'
import { buttonClass } from './classes'
import { UiIcon, type UiIconName } from './UiIcon'

import type { ButtonSize, ButtonVariant } from './classes'

export type { ButtonSize, ButtonVariant }

interface ButtonLook {
  /**
   * `primary` is action green and appears once per screen. `secondary` is the outline
   * default. `ghost` is tertiary and Back. `text` is a link-looking button.
   * `danger` is for destructive confirmations.
   */
  variant?: ButtonVariant
  /** `md` 36px (default), `sm` 32px. */
  size?: ButtonSize
  /** Icon before the label. */
  icon?: UiIconName
  /** Icon after the label, such as `arrow-right` on a wizard's Next. */
  iconEnd?: UiIconName
  /**
   * While true: a spinner in place of the icons, `busyLabel` if given, and every
   * press ignored (a form submit too), so it cannot run twice. It stays
   * focusable, so the focus is not lost while it works.
   */
  busy?: boolean
  /** The label while busy, such as "Testing…". Default the normal label. */
  busyLabel?: ReactNode
  children?: ReactNode
}

export type ButtonProps = ButtonLook & ButtonHTMLAttributes<HTMLButtonElement>

function Content({ icon, iconEnd, children, size, busy, busyLabel }: ButtonLook): JSX.Element {
  const px = size === 'sm' ? 14 : 16
  if (busy) {
    return (
      <>
        <span className="ui-btn-spin" aria-hidden="true" />
        {busyLabel ?? children}
      </>
    )
  }
  return (
    <>
      {icon ? <UiIcon name={icon} size={px} /> : null}
      {children}
      {iconEnd ? <UiIcon name={iconEnd} size={px} /> : null}
    </>
  )
}

/** A busy button swallows the press, including the form submit a click would send. */
function ignorePress(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

/** The v2 button (Theme.dc.html "Buttons"). Defaults to `type="button"`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    icon,
    iconEnd,
    busy = false,
    busyLabel,
    className,
    children,
    type,
    disabled,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={buttonClass(variant, size, className)}
      disabled={disabled}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      {...rest}
      onClick={busy ? ignorePress : rest.onClick}
    >
      <Content icon={icon} iconEnd={iconEnd} size={size} busy={busy} busyLabel={busyLabel}>
        {children}
      </Content>
    </button>
  )
})

/** A link that looks like a v2 button (navigation, such as "Back" to a route). */
export function LinkButton({
  href,
  variant,
  size,
  icon,
  iconEnd,
  children,
  className,
  external = false,
  ...rest
}: Omit<ButtonLook, 'busy' | 'busyLabel'> & {
  href: string
  className?: string
  /** Opens in the browser. */
  external?: boolean
  'aria-label'?: string
  'aria-current'?: 'page' | undefined
  onClick?: MouseEventHandler<HTMLAnchorElement>
}): JSX.Element {
  return (
    <a
      href={href}
      className={buttonClass(variant, size, className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      <Content icon={icon} iconEnd={iconEnd} size={size}>
        {children}
      </Content>
    </a>
  )
}
