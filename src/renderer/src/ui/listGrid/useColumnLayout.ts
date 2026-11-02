import { useCallback, useState } from 'react'

/**
 * A grid's column widths and hidden columns (grid audit R6), kept on this
 * computer per grid (`citefox.grid.<saveKey>`), the way a monday board keeps
 * its column sizes. Without a save key they last until the screen closes. Bad
 * or missing saved data falls back to the defaults.
 */
export interface ColumnLayout {
  /** Column id → width in CSS pixels, for the columns someone resized. */
  widths: Readonly<Record<string, number>>
  /** Column ids someone hid. */
  hidden: readonly string[]
  /** `defaultHidden` column ids someone showed. */
  shown: readonly string[]
}

const EMPTY: ColumnLayout = { widths: {}, hidden: [], shown: [] }
const PREFIX = 'citefox.grid.'
/** Narrowest and widest a column can be dragged. */
export const MIN_COLUMN_WIDTH = 48
export const MAX_COLUMN_WIDTH = 800

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)))
}

export function layoutStorageKey(saveKey: string): string {
  return `${PREFIX}${saveKey}`
}

/** Saved layout text as a layout; anything unreadable is the default. */
export function parseLayout(text: string | null): ColumnLayout {
  if (!text) return EMPTY
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return EMPTY
    const record = value as { widths?: unknown; hidden?: unknown; shown?: unknown }
    const widths: Record<string, number> = {}
    if (typeof record.widths === 'object' && record.widths !== null) {
      for (const [id, width] of Object.entries(record.widths)) {
        if (typeof width === 'number' && Number.isFinite(width)) widths[id] = clampWidth(width)
      }
    }
    const ids = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
    return { widths, hidden: ids(record.hidden), shown: ids(record.shown) }
  } catch {
    return EMPTY
  }
}

function load(saveKey: string | undefined): ColumnLayout {
  if (!saveKey || typeof window === 'undefined') return EMPTY
  try {
    return parseLayout(window.localStorage.getItem(layoutStorageKey(saveKey)))
  } catch {
    return EMPTY
  }
}

function save(saveKey: string | undefined, layout: ColumnLayout): void {
  if (!saveKey || typeof window === 'undefined') return
  try {
    const key = layoutStorageKey(saveKey)
    if (
      Object.keys(layout.widths).length === 0 &&
      layout.hidden.length === 0 &&
      layout.shown.length === 0
    ) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(layout))
    }
  } catch {
    // Storage can be full or blocked; the layout still applies until the screen closes.
  }
}

export interface ColumnLayoutState extends ColumnLayout {
  /** Sets one column's width while dragging; `commit` also saves it. */
  setWidth: (id: string, width: number, commit: boolean) => void
  /** Back to the column's own width (double-click on its edge). */
  resetWidth: (id: string) => void
  /** Every column back to its own width. */
  resetWidths: () => void
  /** The Columns menu's pick: the ids someone hid, and the `defaultHidden` ones they showed. */
  setHidden: (hidden: readonly string[], shown?: readonly string[]) => void
}

export function useColumnLayout(saveKey: string | undefined): ColumnLayoutState {
  const [layout, setLayout] = useState<ColumnLayout>(() => load(saveKey))
  // A different grid on the same component (a new key) reads its own layout.
  const [loadedKey, setLoadedKey] = useState(saveKey)
  let current = layout
  if (loadedKey !== saveKey) {
    current = load(saveKey)
    setLoadedKey(saveKey)
    setLayout(current)
  }

  const update = useCallback(
    (change: (layout: ColumnLayout) => ColumnLayout, commit = true) => {
      setLayout((previous) => {
        const next = change(previous)
        if (commit) save(saveKey, next)
        return next
      })
    },
    [saveKey]
  )

  const setWidth = useCallback(
    (id: string, width: number, commit: boolean) =>
      update(
        (previous) => ({ ...previous, widths: { ...previous.widths, [id]: clampWidth(width) } }),
        commit
      ),
    [update]
  )
  const resetWidth = useCallback(
    (id: string) =>
      update((previous) => {
        const widths = { ...previous.widths }
        delete widths[id]
        return { ...previous, widths }
      }),
    [update]
  )
  const resetWidths = useCallback(
    () => update((previous) => ({ ...previous, widths: {} })),
    [update]
  )
  const setHidden = useCallback(
    (hidden: readonly string[], shown: readonly string[] = []) =>
      update((previous) => ({ ...previous, hidden: [...hidden], shown: [...shown] })),
    [update]
  )
  return { ...current, setWidth, resetWidth, resetWidths, setHidden }
}
