import type { ListColumn } from './types'

/**
 * Developer-only checks on a drawn grid (grid audit R3, R4): a column whose
 * cells all read as numbers should be marked `numeric` (right-aligned,
 * tabular digits), and a value column should sort unless it opts out with
 * `sort: false`. They warn once per grid and column in the console while
 * developing; a packaged app never runs them. Tests turn them on with
 * `setGridDevChecks(true)`.
 */
let enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const warned = new Set<string>()

export function setGridDevChecks(on: boolean): void {
  enabled = on
  warned.clear()
}

export function gridDevChecksOn(): boolean {
  return enabled
}

/** "1,204", "42%", "+11 pts", "−3", "$0.03", "1 / 2", "2–4": a number with its unit. */
const NUMBER_TEXT = /^[+−-]?\$?\d[\d,]*(\.\d+)?(\s?(%|pts?|×))?(\s?[/–]\s?\$?\d[\d,]*(\.\d+)?%?)?$/

/** True when `text` is a number value ("—" and "" are empty, not numbers). */
export function looksNumeric(text: string): boolean {
  return NUMBER_TEXT.test(text.trim())
}

/** True when every non-empty sample reads as a number, and there is at least one. */
export function allNumeric(texts: readonly string[]): boolean {
  const values = texts.map((text) => text.trim()).filter((text) => text !== '' && text !== '—')
  return values.length > 0 && values.every(looksNumeric)
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

/**
 * Looks at the drawn cells of `grid` (the first rows in view) and warns about
 * a number column that is not marked numeric, and a value column with no sort.
 */
export function checkGridColumns<Row>(
  grid: HTMLElement,
  label: string,
  columns: readonly ListColumn<Row>[],
  firstColumn: number
): void {
  if (!enabled) return
  const rows = [...grid.querySelectorAll<HTMLElement>('[data-row]')].slice(0, 12)
  if (rows.length === 0) return
  columns.forEach((column, at) => {
    if (column.hideLabel) return
    if (!column.numeric && column.align === undefined) {
      const texts = rows.map(
        (row) =>
          row.querySelectorAll<HTMLElement>('[role="gridcell"]')[firstColumn + at]?.textContent ??
          ''
      )
      if (allNumeric(texts)) {
        warnOnce(
          `${label}:${column.id}:numeric`,
          `ListGrid "${label}": column "${column.id}" holds numbers. Mark it numeric: true so it lines up on the right.`
        )
      }
    }
    if (column.sort === undefined && !column.copy && !column.rowAction) {
      warnOnce(
        `${label}:${column.id}:sort`,
        `ListGrid "${label}": column "${column.id}" can't be sorted. Give it a sort, or sort: false when sorting makes no sense.`
      )
    }
  })
}
