import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent
} from 'react'
import { useDialog } from '../../components/useDialog'
import { useLatest } from '../../components/useLatest'
import { Button } from '../Button'
import { Confirm } from '../Confirm'
import { CopyText } from '../CopyText'
import { IconButton } from '../IconButton'
import { ToolButton } from '../Tools'
import { Breadcrumbs } from './Breadcrumbs'
import { DrawerIdContext, useDrawerLevel } from './context'
import { DrawerFooter } from './DrawerFooter'
import { DrawerSkeleton } from './layout'
import type { DrawerCrumb, DrawerGuardCopy, DrawerProps } from './types'

const GUARD: DrawerGuardCopy = {
  title: 'Discard changes?',
  body: 'What you changed here is not saved.',
  keepLabel: 'Keep editing',
  discardLabel: 'Discard'
}

const FIELD = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])'
]
  .map((item) => `.ui-drawer-body ${item}`)
  .join(', ')

/** Where focus goes on open: `[data-autofocus]`, else the first field, else the title. */
function firstFocus(node: HTMLElement | null, mode: 'auto' | 'close'): HTMLElement | null {
  if (!node) return null
  if (mode === 'close') return node.querySelector<HTMLElement>('.ui-drawer-close')
  return (
    node.querySelector<HTMLElement>('[data-autofocus]') ??
    node.querySelector<HTMLElement>(FIELD) ??
    node.querySelector<HTMLElement>('.ui-drawer-title')
  )
}

/**
 * The one drawer (Docs/DRAWER.md, DrawerStandard.dc.html): 80% of the window
 * from the right (at least 880, at most 1280 px), over a scrim. Header:
 * breadcrumbs, the title with its step and status, and ✕. Body: scrolls on
 * its own, laid out with DrawerGrid. Footer: always there, sticky by layout.
 *
 * ✕, Escape, a press on the scrim, Cancel, a crumb and (through the router)
 * browser Back all ask "Discard changes?" first while `dirty`. Focus moves
 * in, Tab stays inside, and focus goes back to the opener on close. A second
 * drawer opened from this one stacks over it, 48 px narrower.
 */
export function Drawer({
  id,
  title,
  heading,
  crumbs: givenCrumbs,
  trail = [],
  subtitle,
  step,
  status,
  tools,
  headerExtra,
  footer = {},
  dirty = false,
  guard,
  closeDisabled = false,
  busy = false,
  loading = false,
  error,
  onClose,
  initialFocus,
  focusOnOpen = 'auto',
  focusKey,
  depth: givenDepth,
  testId,
  className,
  attributes,
  children
}: DrawerProps): JSX.Element {
  const level = useDrawerLevel()
  const depth = givenDepth ?? level?.depth ?? 0
  const titleId = useId()
  const subtitleId = useId()
  const [asking, setAsking] = useState<{ then: () => void } | null>(null)
  const latest = useLatest({ dirty, closeDisabled, onClose })
  const firstTarget = useRef<HTMLElement | null>(null)

  /** Runs `then` (default: close) now, or after "Discard changes?" when there are changes. */
  function request(then?: () => void): void {
    const { dirty: changed, closeDisabled: locked, onClose: close } = latest.current
    if (locked) return
    const proceed = then ?? close
    if (changed) setAsking({ then: proceed })
    else proceed()
  }

  const ref = useDialog<HTMLDivElement>({
    onClose: () => request(),
    initialFocus: firstTarget,
    focusKey
  })

  // Layout effects run before useDialog's focus effect, so the target is ready.
  useLayoutEffect(() => {
    firstTarget.current = initialFocus?.current ?? firstFocus(ref.current, focusOnOpen)
  }, [initialFocus, focusOnOpen, focusKey, ref])

  const registerGuard = level?.registerGuard
  useEffect(() => {
    if (!registerGuard) return
    return registerGuard({ dirty, ask: () => setAsking({ then: () => latest.current.onClose() }) })
  }, [registerGuard, dirty, latest])

  function onCrumb(crumb: DrawerCrumb, event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    request(() => {
      if (crumb.onSelect) crumb.onSelect()
      else if (crumb.href !== undefined) {
        if (level?.navigate) level.navigate(crumb.href)
        else window.location.hash = crumb.href
      }
    })
  }

  // The title sits right below the trail, so the trail stops at the drawer's parent.
  const crumbs = givenCrumbs ?? [...(level?.crumbs ?? []), ...trail]
  const copy = { ...GUARD, ...guard }

  return (
    <DrawerIdContext.Provider value={id}>
      <div
        className={`ui-drawer-scrim ui-drawer-scrim-${depth}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) request()
        }}
      >
        <div
          ref={ref}
          className={['ui-drawer', `ui-drawer-depth-${depth}`, className ?? '']
            .filter(Boolean)
            .join(' ')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          aria-busy={busy || loading || undefined}
          data-drawer={id}
          data-drawer-depth={depth}
          data-testid={testId}
          {...attributes}
        >
          <div className="ui-drawer-head">
            <Breadcrumbs crumbs={crumbs} onCrumb={onCrumb} />
            <div className="ui-drawer-titlerow">
              <h2 id={titleId} className="ui-drawer-title" tabIndex={-1}>
                {heading ?? title}
              </h2>
              {status ? <div className="ui-drawer-status">{status}</div> : null}
              {step ? (
                <span className="ui-drawer-step num">
                  Step {step.current} of {step.total}
                </span>
              ) : null}
              {tools?.map((tool) => (
                <ToolButton
                  key={tool.id}
                  kind={tool.kind}
                  {...(tool.label ? { label: tool.label } : {})}
                  disabled={tool.disabled ?? false}
                  className="ui-drawer-tool"
                  onClick={tool.onClick}
                />
              ))}
              <IconButton
                icon="x"
                label={`Close ${title}`}
                title="Close (Esc)"
                className="ui-drawer-close"
                disabled={closeDisabled}
                onClick={() => request()}
              />
            </div>
            {subtitle ? (
              <p id={subtitleId} className="ui-drawer-subtitle">
                {subtitle}
              </p>
            ) : null}
            {headerExtra ? <div className="ui-drawer-extra">{headerExtra}</div> : null}
          </div>
          <div className="ui-drawer-body">
            {error ? (
              <div className="ui-drawer-failed" role="alert">
                <p>
                  <CopyText text={error.message} wrap />
                </p>
                {error.onRetry ? (
                  <Button variant="secondary" onClick={error.onRetry}>
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : loading ? (
              <>
                <p className="sr-only" role="status">
                  Loading {title}…
                </p>
                <DrawerSkeleton />
              </>
            ) : (
              children
            )}
          </div>
          <DrawerFooter spec={footer} onCancel={() => request()} cancelDisabled={closeDisabled} />
        </div>
      </div>
      {asking ? (
        <Confirm
          title={copy.title}
          body={copy.body}
          cancelLabel={copy.keepLabel}
          confirmLabel={copy.discardLabel}
          testId="drawer-discard"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const { then } = asking
            setAsking(null)
            then()
          }}
        />
      ) : null}
    </DrawerIdContext.Provider>
  )
}
