import { useEffect, type CSSProperties, type JSX, type ReactNode } from 'react'
import { countNoun } from '../m3/model'
import { useDrill, type DrillApi } from './context'
import { isExternal, targetHref } from './targets'
import { drillCount, drillNoun, type DrillRequest, type DrillTarget } from './types'

/** Registers the drill a control opens, so a copied drill link finds it again. */
function useRegisteredDrill(drill: DrillRequest): DrillApi['open'] {
  const { open, register } = useDrill()
  useEffect(() => register(drill), [register, drill])
  return open
}

/**
 * A number that opens the drawer of exactly what it counts. The number shown
 * is the drill's own row count, so the drawer total equals it by
 * construction (NFR-14). Carries `data-nfr-drill` and `data-nfr-figure`.
 * Zero has nothing to open: it is plain text (as grid cells draw it), not a
 * button to an empty drawer.
 */
export function DrillNumber({
  drill,
  label,
  suffix,
  headline,
  className,
  style
}: {
  drill: DrillRequest
  /** Accessible name. Default "3 prompts: Page cited". It must contain the number. */
  label?: string
  /** NFR-14 headline id (`data-nfr-headline`), when this is a screen's headline number. */
  headline?: string
  /** Text after the number inside the button, such as " prompts". */
  suffix?: ReactNode
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const open = useRegisteredDrill(drill)
  const count = drillCount(drill)
  const noun = drillNoun(drill)
  if (count === 0) {
    return (
      <span className={className ? `drill-num-zero ${className}` : 'drill-num-zero'} style={style}>
        <span data-nfr-figure={drill.id} data-nfr-headline={headline}>
          0
        </span>
        {keepLeadingSpace(suffix)}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={className ? `drill-num ${className}` : 'drill-num'}
      style={style}
      aria-label={label ?? `${countNoun(count, noun[0], noun[1])}: ${drill.title}`}
      data-nfr-drill={drill.id}
      data-drill-open=""
      onClick={() => open(drill)}
    >
      <span data-nfr-figure={drill.id} data-nfr-headline={headline}>
        {count}
      </span>
      {keepLeadingSpace(suffix)}
    </button>
  )
}

/**
 * `.drill-num` buttons are inline-flex, which drops a text suffix's leading space
 * ("2cases"). A no-break space survives the flex layout.
 */
function keepLeadingSpace(suffix: ReactNode): ReactNode {
  return typeof suffix === 'string' && suffix.startsWith(' ') ? `\u00a0${suffix.slice(1)}` : suffix
}

/**
 * The count of a drill, for use inside a `DrillButton` whose content is more
 * than the number (a KPI tile, a bucket card). Marked `data-nfr-figure`.
 */
export function DrillFigure({
  drill,
  headline,
  className
}: {
  drill: DrillRequest
  /** NFR-14 headline id (`data-nfr-headline`), when this is a screen's headline number. */
  headline?: string
  className?: string
}): JSX.Element {
  return (
    <span className={className} data-nfr-figure={drill.id} data-nfr-headline={headline}>
      {drillCount(drill)}
    </span>
  )
}

/**
 * Any other control that opens a drawer: a domain name, a bar, a segment, a
 * row header. Marked `data-nfr-drill` so the NFR-14 check opens it; the same
 * id needs a `DrillNumber` (or a `data-nfr-figure`) on the screen.
 * Pass `untracked` for a control whose drawer is already counted elsewhere
 * and that shows no number of its own.
 */
export function DrillButton({
  drill,
  children,
  label,
  className = 'm3-link',
  style,
  untracked = false
}: {
  drill: DrillRequest
  children: ReactNode
  label?: string
  className?: string
  style?: CSSProperties
  untracked?: boolean
}): JSX.Element {
  const open = useRegisteredDrill(drill)
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      data-nfr-drill={untracked ? undefined : drill.id}
      data-drill-open=""
      onClick={() => open(drill)}
    >
      {children}
    </button>
  )
}

/**
 * A single item goes straight to its detail, never to a one-row drawer:
 * a prompt to Prompt detail, a page to its tab, a URL to the browser.
 */
export function DrillLink({
  target,
  children,
  label,
  className,
  style
}: {
  target: DrillTarget
  children: ReactNode
  label?: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const href = targetHref(target)
  if (!href) return <span className={className}>{children}</span>
  if (isExternal(target)) {
    return (
      <a
        className={className}
        style={style}
        href={href}
        aria-label={label}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
        {label ? null : <span className="sr-only"> (opens in your browser)</span>}
      </a>
    )
  }
  return (
    <a className={className} style={style} href={href} aria-label={label}>
      {children}
    </a>
  )
}
