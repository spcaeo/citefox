import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton, UiIcon } from '../../ui'
import { findFirst, useAnchorRect } from '../hooks/useAnchorRect'
import type { GuideStep } from '../types'
import { PAD, placePopover, type Box } from '../utils/position'
import { contains, padded, sameBox } from '../utils/press'

/** The popover's size before it is measured. */
const START_SIZE = { width: 340, height: 200 }

/** Pop-ups a step can open over the screen: a menu, the top bar search's results. */
const POPUPS = ['.ui-menu', '.topbar-results'] as const

/** The smallest box holding both. */
function union(a: Box, b: Box): Box {
  const top = Math.min(a.top, b.top)
  const left = Math.min(a.left, b.left)
  return {
    top,
    left,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top
  }
}

function focusable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.focus === 'function'
}

/**
 * One step on screen (a coachmark): the real element in a soft spotlight,
 * and beside it what it is, why it matters and what to do. A step that waits for
 * a real action says so instead of offering "Got it": the control to click pulses,
 * and "Open it for me" (the step's `press`) clicks it, so the drawer, tab or page
 * really opens. The rest of the window stays clickable, so the user can do the
 * real thing too. A step reached again by Back is done already: it says so and
 * offers Next. Esc pauses; focus moves to the popover and goes back where it was
 * when the step ends.
 */
export function Coachmark({
  step,
  index,
  total,
  lessonTitle,
  why = null,
  note = null,
  target = [],
  reviewing = false,
  canBack,
  onBack,
  onSkip,
  onDone,
  onNext,
  onPause
}: {
  step: GuideStep
  /** "Step 2 of 5" inside the lesson. */
  index: number
  total: number
  lessonTitle: string
  /** Why this step matters for this project, from its data ("11 questions already cite your site…"). */
  why?: string | null
  /** A kind line when the project has nothing to show here yet (see `GuideStep.note`). */
  note?: string | null
  /** The control to click, best first (see `pressSelectors`); it pulses and "Open it for me" clicks it. */
  target?: readonly string[]
  /** The step is done already and was reached by Back or "Show me": Next instead of the action. */
  reviewing?: boolean
  canBack: boolean
  onBack: () => void
  onSkip: () => void
  onDone: () => void
  /** Next in review. */
  onNext?: () => void
  onPause: () => void
}): JSX.Element {
  const { box, missing } = useAnchorRect(step.anchor)
  const acts = step.action !== undefined
  const control = useAnchorRect(acts && target.length > 0 ? target : null).box
  const found = box !== null
  // A menu or the search's results the step opened (the theme menu, Ctrl+K): the dim
  // steps aside and the popover moves below it, so both stay readable.
  const popup = useAnchorRect(POPUPS).box
  const titleId = useId()
  const bodyId = useId()
  const popover = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [size, setSize] = useState(START_SIZE)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })

  // Focus goes to the step's title, and back where it was when the coachmark closes,
  // unless it has moved on (into the drawer the step opened).
  useEffect(() => {
    const before = document.activeElement
    const node = popover.current
    heading.current?.focus()
    return () => {
      const now = document.activeElement
      const lost = now === null || now === document.body || (node?.contains(now) ?? false)
      if (lost && focusable(before) && document.contains(before)) before.focus()
    }
  }, [step.id])

  useLayoutEffect(() => {
    const node = popover.current
    if (!node) return
    const next = {
      width: node.offsetWidth || START_SIZE.width,
      height: node.offsetHeight || START_SIZE.height
    }
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    )
  }, [step.id, missing, found])

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A menu or a drawer closes first; the next Esc pauses the guide.
      if (document.querySelector('[role="menu"], .ui-drawer-scrim')) return
      event.preventDefault()
      onPause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPause])

  const anchorBox: Box | null = box && !missing ? box : null
  // The spotlight: the anchor with the control in it, else the control alone (the
  // rival's row when the anchor found another one).
  const shown: Box | null =
    anchorBox && control && !contains(anchorBox, control) ? control : (anchorBox ?? control)
  // The control pulses on its own ring when it is smaller than the spotlight.
  const pulse: Box | null = control && shown && !sameBox(control, shown) ? control : null
  // The popover sits by what to click.
  const point = pulse ?? shown
  const near = popup && point ? union(point, popup) : (popup ?? point)
  // Beside the whole spotlight when it fits above or below it (a list with a button to
  // press inside), so the popover never covers the rows; else by what to click.
  const whole =
    pulse && shown && !popup && shown.height < viewport.height / 2
      ? placePopover(padded(shown, PAD), size, viewport)
      : null
  const place =
    whole && (whole.side === 'bottom' || whole.side === 'top')
      ? whole
      : placePopover(near ? padded(near, PAD) : null, size, viewport)
  const waiting = acts && !missing && !reviewing

  // The control shows while the guide points at it, even one a row shows only on hover.
  const targetKey = target.join('\n')
  const pulsing = control !== null
  useEffect(() => {
    if (!pulsing) return
    const element = findFirst(targetKey.split('\n'))
    element?.setAttribute('data-guide-on', '')
    return () => element?.removeAttribute('data-guide-on')
  }, [pulsing, targetKey])
  const canPress = step.press !== undefined && !missing

  /** "Open it for me": the real click on the real control, so what it opens opens. */
  function press(): void {
    const found = findFirst(target)
    // A grid cell (a closed group's name) clicks its own button; a row clicks itself.
    const element =
      found instanceof HTMLElement && found.matches('[role="gridcell"]')
        ? (found.querySelector<HTMLElement>('button, a[href]') ?? found)
        : found
    if (!(element instanceof HTMLElement)) return
    if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
    element.click()
  }

  return createPortal(
    <div
      className="gd-coach"
      data-step={step.id}
      data-layer={step.layer}
      data-popup={popup ? '' : undefined}
    >
      <svg className="gd-mask" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id={`gd-cut-${step.id}`}>
            <rect width="100%" height="100%" fill="white" />
            {shown ? (
              <rect
                x={shown.left - PAD}
                y={shown.top - PAD}
                width={shown.width + PAD * 2}
                height={shown.height + PAD * 2}
                rx={8}
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" className="gd-dim" mask={`url(#gd-cut-${step.id})`} />
      </svg>
      {shown ? (
        <div
          className={pulse ? 'gd-ring gd-ring-still' : 'gd-ring'}
          aria-hidden="true"
          style={padded(shown, PAD)}
        />
      ) : null}
      {pulse ? (
        <div className="gd-ring gd-ring-press" aria-hidden="true" style={padded(pulse, 3)} />
      ) : null}
      <div
        ref={popover}
        className="gd-pop"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-side={place.side}
        style={{ top: place.top, left: place.left }}
      >
        <div className="gd-pop-head">
          <p className="gd-eyebrow">
            Step {index} of {total} · {lessonTitle}
          </p>
          <IconButton
            icon="x"
            size="sm"
            label="Pause the guide"
            data-tip="Pause (Esc)"
            onClick={onPause}
          />
        </div>
        <h2 className="gd-pop-title" id={titleId} ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="gd-pop-body" id={bodyId}>
          {step.body}
        </p>
        {why ? <p className="gd-pop-why">{why}</p> : null}
        {note ? (
          <p className="gd-pop-note" role="note" data-testid="guide-note">
            {note}
          </p>
        ) : null}
        {missing && !note ? (
          <p className="gd-pop-note" role="note">
            This isn’t on the screen right now, so you can skip it and come back later.
          </p>
        ) : reviewing ? (
          <p className="gd-pop-hint" data-testid="guide-reviewing">
            <UiIcon name="check" size={14} />
            <span>You’ve done this one. Next takes you on.</span>
          </p>
        ) : waiting ? (
          <p className="gd-pop-hint">
            <UiIcon name="arrow-right" size={14} />
            <span>
              {step.action} {canPress ? `Or use “${step.press}”. ` : ''}The guide moves on by
              itself.
            </span>
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {`Step ${index} of ${total}: ${step.title}.`}
        </p>
        <div className="gd-pop-actions">
          {canBack ? (
            <Button size="sm" variant="ghost" icon="arrow-left" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <span className="gd-spacer" />
          {reviewing ? (
            <>
              {canPress ? (
                <Button size="sm" variant="secondary" onClick={press}>
                  {step.press}
                </Button>
              ) : null}
              <Button size="sm" variant="primary" iconEnd="arrow-right" onClick={onNext ?? onDone}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant={missing ? 'primary' : 'secondary'} onClick={onSkip}>
                Skip
              </Button>
              {missing ? null : waiting ? (
                canPress ? (
                  <Button size="sm" variant="primary" onClick={press} data-testid="guide-press">
                    {step.press}
                  </Button>
                ) : null
              ) : (
                <Button size="sm" variant="primary" onClick={onDone}>
                  Got it
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
