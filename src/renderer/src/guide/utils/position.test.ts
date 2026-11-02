import { describe, expect, test } from 'vitest'
import { EDGE, GAP, PAD, isOnScreen, needsScroll, placeHint, placePopover } from './position'

const VIEW = { width: 1280, height: 800 }
const POP = { width: 340, height: 200 }

describe('placePopover', () => {
  test('below the element when it fits, aligned to its left edge', () => {
    const place = placePopover({ top: 100, left: 200, width: 120, height: 32 }, POP, VIEW)
    expect(place).toEqual({ top: 100 + 32 + PAD + GAP, left: 200, side: 'bottom' })
  })

  test('above when there is no room below', () => {
    const place = placePopover({ top: 700, left: 200, width: 120, height: 32 }, POP, VIEW)
    expect(place.side).toBe('top')
    expect(place.top).toBe(700 - PAD - GAP - POP.height)
  })

  test('to the right, then the left, for a tall narrow element', () => {
    const right = placePopover({ top: 150, left: 40, width: 200, height: 600 }, POP, VIEW)
    expect(right.side).toBe('right')
    expect(right.left).toBe(40 + 200 + PAD + GAP)
    const left = placePopover({ top: 150, left: 900, width: 300, height: 600 }, POP, VIEW)
    expect(left.side).toBe('left')
    expect(left.left).toBe(900 - PAD - GAP - POP.width)
  })

  test('kept inside the window near its right edge', () => {
    const place = placePopover({ top: 60, left: 1200, width: 60, height: 28 }, POP, VIEW)
    expect(place.left).toBe(VIEW.width - POP.width - EDGE)
  })

  test('a whole-screen element puts the popover inside its lower edge; no element centres it', () => {
    const inside = placePopover({ top: 0, left: 0, width: 1280, height: 800 }, POP, VIEW)
    expect(inside).toEqual({ top: VIEW.height - POP.height - EDGE, left: EDGE, side: 'bottom' })
    expect(placePopover(null, POP, VIEW)).toEqual({ top: 300, left: 470, side: 'center' })
  })

  test('isOnScreen', () => {
    expect(isOnScreen({ top: 10, left: 10, width: 10, height: 10 }, VIEW)).toBe(true)
    expect(isOnScreen({ top: 900, left: 10, width: 10, height: 10 }, VIEW)).toBe(false)
    expect(isOnScreen({ top: -50, left: 10, width: 10, height: 10 }, VIEW)).toBe(false)
  })
})

describe('placeHint', () => {
  const BUBBLE = { width: 240, height: 44 }

  test('on the side asked for, the arrow at the middle of a small control', () => {
    const place = placeHint({ top: 700, left: 1000, width: 140, height: 32 }, BUBBLE, VIEW, 'top')
    expect(place.side).toBe('top')
    expect(place.top).toBe(700 - GAP - BUBBLE.height)
    expect(place.left + place.arrow).toBe(1000 + 70)
  })

  test('left of a list inside a drawer, pointing near its top', () => {
    const place = placeHint({ top: 300, left: 700, width: 500, height: 400 }, BUBBLE, VIEW, 'left')
    expect(place).toMatchObject({ side: 'left', left: 700 - GAP - BUBBLE.width })
    expect(place.top + place.arrow).toBe(300 + 28)
  })

  test('falls back to a side with room, inside the window', () => {
    const place = placeHint({ top: 300, left: 20, width: 100, height: 32 }, BUBBLE, VIEW, 'left')
    expect(place.side).toBe('bottom')
    expect(place.left).toBeGreaterThanOrEqual(EDGE)
  })
})

describe('needsScroll', () => {
  test('off screen, or a small control at the very bottom; never a tall list that is showing', () => {
    expect(needsScroll({ top: 900, left: 0, width: 100, height: 30 }, VIEW)).toBe(true)
    expect(needsScroll({ top: 770, left: 0, width: 100, height: 30 }, VIEW)).toBe(true)
    expect(needsScroll({ top: 300, left: 0, width: 100, height: 30 }, VIEW)).toBe(false)
    expect(needsScroll({ top: 400, left: 0, width: 1000, height: 1200 }, VIEW)).toBe(false)
  })
})
