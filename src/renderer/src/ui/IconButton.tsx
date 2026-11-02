import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { UiIcon, type UiIconName } from './UiIcon'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: UiIconName
  /** Accessible name. Required: an icon button has no visible text. */
  label: string
  /** `md` 32px (default), `sm` 28px (grid rows, cards). */
  size?: 'md' | 'sm'
  /** Shows the label as a tooltip on hover and focus (section and card heads). */
  tip?: boolean
}

/** A 32px (or 28px) borderless square button with one icon (Theme.dc.html `btn-icon`). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', tip = false, className, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      data-tip={tip ? label : undefined}
      className={['ui-icon-btn', size === 'sm' ? 'ui-icon-btn-sm' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <UiIcon name={icon} size={16} />
    </button>
  )
})
