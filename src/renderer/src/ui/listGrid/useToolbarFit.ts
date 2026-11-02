import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** The search box never gets narrower than this (list-grid.css `.ui-lg-search`). */
export const SEARCH_MIN = 200
/** The Filter ▾ button's width before it has been drawn once. */
const MENU_GUESS = 112
const GAP_GUESS = 12

/** What the toolbar row holds, in pixels, for {@link planToolbar}. */
export interface ToolbarSizes {
  /** The row's inner width. 0 (not measured yet) moves nothing. */
  available: number
  gap: number
  /** Items that always stay in the row: search, the engine spot, actions, Columns, AI. */
  fixed: readonly number[]
  /** Filters that may move into Filter ▾, in toolbar order. The last moves first. */
  movable: readonly { id: string; width: number }[]
  /** The Filter ▾ button. `own`: it shows anyway (the list has menu filters of its own). */
  menu: { width: number; own: boolean }
}

/**
 * Which filters move into Filter ▾ so the toolbar keeps one row (audit2 #7):
 * none while everything fits, else the fewest from the end, counting the
 * Filter ▾ button that then has to show. Every one when even that is not enough.
 */
export function planToolbar(sizes: ToolbarSizes): readonly string[] {
  const { available, gap, fixed, movable, menu } = sizes
  if (available <= 0 || movable.length === 0) return []
  for (let moved = 0; moved <= movable.length; moved += 1) {
    const widths = [...fixed, ...movable.slice(0, movable.length - moved).map((item) => item.width)]
    if (menu.own || moved > 0) widths.push(menu.width)
    const need = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)
    if (need <= available) return movable.slice(movable.length - moved).map((item) => item.id)
  }
  return movable.map((item) => item.id)
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => b[at] === id)
}

function px(value: string): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * Measures the toolbar row (`ref`) and returns the ids of the filters that
 * move into Filter ▾. Movable filters carry `data-lg-move="<id>"`, the Filter
 * ▾ button's wrapper `data-lg-filter`; every other item stays. A filter's
 * width is remembered from when it last showed, so it comes back once it fits.
 * Re-measures after every render and whenever the row changes size.
 */
export function useToolbarFit(
  ref: RefObject<HTMLElement | null>,
  movable: readonly string[],
  ownMenu: boolean
): readonly string[] {
  const [moved, setMoved] = useState<readonly string[]>([])
  const widths = useRef(new Map<string, number>())
  const menuWidth = useRef(MENU_GUESS)
  const key = movable.join('\n')

  const measure = useCallback(() => {
    const bar = ref.current
    if (!bar) return
    const style = getComputedStyle(bar)
    const fixed: number[] = []
    for (const child of Array.from(bar.children) as HTMLElement[]) {
      if (child.classList.contains('ui-lg-spacer')) continue
      const id = child.dataset.lgMove
      if (id !== undefined) {
        if (child.offsetWidth > 0) widths.current.set(id, child.offsetWidth)
      } else if (child.dataset.lgFilter !== undefined) {
        if (child.offsetWidth > 0) menuWidth.current = child.offsetWidth
      } else if (child.classList.contains('ui-lg-search')) {
        fixed.push(SEARCH_MIN)
      } else {
        fixed.push(child.offsetWidth)
      }
    }
    const next = planToolbar({
      available: bar.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
      gap: px(style.columnGap) || GAP_GUESS,
      fixed,
      movable: key
        .split('\n')
        .filter(Boolean)
        .map((id) => ({ id, width: widths.current.get(id) ?? 0 })),
      menu: { width: menuWidth.current, own: ownMenu }
    })
    setMoved((current) => (same(current, next) ? current : next))
  }, [ref, key, ownMenu])

  // After every render: a filter's label or an action may have changed width.
  useLayoutEffect(measure)

  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(bar)
    return () => observer.disconnect()
  }, [ref, measure])

  return moved.filter((id) => movable.includes(id))
}
