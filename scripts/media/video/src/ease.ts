/**
 * Easing curves for the product video. The curve values and the analytic spring
 * are ported from snap-cn (https://github.com/shadcn-labs/snapcn, MIT License,
 * Copyright (c) 2026 Sri Nath (snap-cn)): registry/snap-cn/text-reveal and laptop-frame.
 * See NOTICE. The cubic-bezier solver is the usual Newton–Raphson one.
 */

export type Ease = (t: number) => number

export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  const solve = (x: number): number => {
    let t = x
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x
      if (Math.abs(error) < 1e-6) return t
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= error / d
    }
    let lo = 0
    let hi = 1
    t = x
    while (lo < hi) {
      const value = sampleX(t)
      if (Math.abs(value - x) < 1e-6) return t
      if (x > value) lo = t
      else hi = t
      t = (lo + hi) / 2
      if (hi - lo < 1e-6) break
    }
    return t
  }
  return (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)))
}

/** snap-cn "smooth": quick off the mark, long soft landing. */
export const smooth = bezier(0.22, 1, 0.36, 1)
/** snap-cn WORD_EASE: a word pushing into its slot. */
export const word = bezier(0.22, 0.8, 0.36, 1)
/** snap-cn CAMERA_EASE (laptop-frame): the camera's travel. */
export const camera = bezier(0.2, 0.6, 0.35, 1)
/** snap-cn ZOOM_EASE: barely moves, then carries and brakes to a dead stop. */
export const zoom = bezier(0.5, 0, 0.05, 1)
/** snap-cn EXIT_EASING: accelerating exits. */
export const exit = bezier(0.64, 0, 0.78, 0)
export const inOut = bezier(0.65, 0, 0.35, 1)

/** snap-cn springEase: a damped spring, settles at 1 with a ~1% overshoot. */
export const spring: Ease = (t) => (t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(4.5 * t))
