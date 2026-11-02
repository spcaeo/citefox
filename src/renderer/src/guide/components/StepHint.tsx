import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { UiIcon } from '../../ui'
import { announce } from '../../ui/announce'
import { findFirst } from '../hooks/useAnchorRect'
import type { GuideHint } from '../types'
import { placeHint, type Box } from '../utils/position'
import { padded, sameBox } from '../utils/press'

/** The bubble's size before it is measured. */
const START_SIZE = { width: 260, height: 44 }

interface Active {
  index: number
  box: Box
}

/** True when the control can be used now: on the page, laid out, and not disabled. */
function ready(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element.matches(':disabled, [aria-disabled="true"]')) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** The last hint whose control is ready, with its box; null when none is. */
function activeHint(hints: readonly GuideHint[]): Active | null {
  for (let index = hints.length - 1; index >= 0; index -= 1) {
    const element = findFirst([(hints[index] as GuideHint).anchor])
    if (ready(element)) {
      const rect = element.getBoundingClientRect()
      return {
        index,
        box: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      }
    }
  }
  return null
}

/**
 * The guide inside what a step's click opened (a drawer, tab or menu): no dim,
 * only the next control pulsing and a small bubble beside it saying what to do.
 * The last hint whose control is ready shows, so it moves on by itself from "Pick
 * a page" to "Click Save" as the user goes. It never takes a click or focus; a
 * screen reader hears each new line once (the drawer is modal, so the bubble
 * itself is hidden from it).
 */
export function StepHint({ hints }: { hints: readonly GuideHint[] }): JSX.Element | null {
  const [active, setActive] = useState<Active | null>(null)
  const [size, setSize] = useState(START_SIZE)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const bubble = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const measure = (): void => {
      const next = activeHint(hints)
      setActive((current) =>
        current === next ||
        (current !== null &&
          next !== null &&
          current.index === next.index &&
          sameBox(current.box, next.box))
          ? current
          : next
      )
      setViewport((current) =>
        current.width === window.innerWidth && current.height === window.innerHeight
          ? current
          : { width: window.innerWidth, height: window.innerHeight }
      )
    }
    measure()
    // Drawers load and re-lay out after they open; a light poll follows them.
    const timer = window.setInterval(measure, 250)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [hints])

  const index = active?.index ?? null
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node) return
    const next = {
      width: node.offsetWidth || START_SIZE.width,
      height: node.offsetHeight || START_SIZE.height
    }
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    )
  }, [index])

  // The control shows while the bubble points at it, like the coachmark's.
  const hintAnchor = index === null ? null : (hints[index]?.anchor ?? null)
  useEffect(() => {
    if (hintAnchor === null) return
    const element = findFirst([hintAnchor])
    element?.setAttribute('data-guide-on', '')
    return () => element?.removeAttribute('data-guide-on')
  }, [hintAnchor])

  // Each new line is said once, through the app's shared live region.
  const text = index === null ? null : (hints[index]?.text ?? null)
  useEffect(() => {
    if (text !== null) announce(text)
  }, [text])

  if (active === null) return null
  const hint = hints[active.index] as GuideHint
  const place = placeHint(padded(active.box, 3), size, viewport, hint.side)
  const style = { top: place.top, left: place.left, '--gd-arrow': `${place.arrow}px` }
  return createPortal(
    <div className="gd-hint-layer" data-hint={active.index}>
      <div className="gd-ring gd-ring-press" aria-hidden="true" style={padded(active.box, 3)} />
      <div
        ref={bubble}
        className="gd-hint"
        data-side={place.side}
        style={style as CSSProperties}
        data-testid="guide-hint"
        aria-hidden="true"
      >
        <UiIcon name="bulb" size={14} />
        <span>{hint.text}</span>
      </div>
    </div>,
    document.body
  )
}
