import type { GuideFacts, GuideStep } from '../types'
import type { Box } from './position'

/**
 * What a step's pulse sits on and its "do it for me" button clicks, best first:
 * the exact control for this project's data, then the anchor's own control.
 */
export function pressSelectors(step: GuideStep, facts: GuideFacts): string[] {
  const { anchor } = step
  return [
    ...(step.target?.(facts) ?? []),
    `button${anchor}`,
    `a${anchor}`,
    `${anchor} button:not(:disabled)`,
    `${anchor} a[href]`
  ]
}

/** True when `inner` sits inside `outer` (a button inside its line). */
export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.left + inner.width <= outer.left + outer.width + 1 &&
    inner.top + inner.height <= outer.top + outer.height + 1
  )
}

/** True when two boxes are the same element's, give or take a pixel. */
export function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.top - b.top) <= 1 &&
    Math.abs(a.left - b.left) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  )
}

/** `box` grown by `pad` on every side. */
export function padded(box: Box, pad: number): Box {
  return {
    top: box.top - pad,
    left: box.left - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2
  }
}
