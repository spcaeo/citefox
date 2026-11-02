import type { Page } from '@playwright/test'

/** One grid's header cells and how its body rows line up with them. */
export interface GridReport {
  /** A short name for the grid: its aria-label, or its class. */
  name: string
  headers: { label: string; left: number; width: number }[]
  /** Body rows whose cells start or end more than 2px away from their header cell. */
  misaligned: string[]
  /** Header labels wider than their column (clipped, or a word that does not fit). */
  crushed: string[]
  rows: number
}

/**
 * Every visible grid or table inside `scope`: header cells against body cells
 * (same left edge and width within 2px), and each header label's longest word
 * against its column's content width. Rows with a different cell count (an
 * empty-state row, a group heading) are skipped.
 */
export async function gridReports(page: Page, scope = '#main'): Promise<GridReport[]> {
  return page.evaluate((root) => {
    const container = document.querySelector(root)
    if (!container) return []
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    const ownCells = (row: Element, selector: string): HTMLElement[] =>
      [...row.querySelectorAll<HTMLElement>(selector)].filter(
        (cell) => cell.closest('[role="row"], tr') === row
      )
    const measure = document.createElement('span')
    measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px'
    document.body.append(measure)
    const reports = []
    /**
     * A cell's box without its borders: a pinned cell (ui/list-grid-pin.css) paints
     * its ground over transparent borders that reach into the row's padding and gap,
     * which is not its column's width.
     */
    const cellBox = (element: Element): { left: number; width: number } => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const borderLeft = parseFloat(style.borderLeftWidth) || 0
      const borderRight = parseFloat(style.borderRightWidth) || 0
      return { left: box.left + borderLeft, width: box.width - borderLeft - borderRight }
    }
    const hidden = (element: Element): boolean => {
      const box = element.getBoundingClientRect()
      return box.width <= 1 || box.height <= 1
    }
    /** Visible words of a header cell with the element that renders each (screen-reader text left out). */
    const words = (cell: Element): { word: string; owner: Element }[] => {
      const out: { word: string; owner: Element }[] = []
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const owner = node.parentElement
        if (!owner || hidden(owner)) continue
        for (const word of (node.textContent ?? '').split(/\s+/))
          if (word) out.push({ word, owner })
      }
      return out
    }
    const grids = [
      ...(container.matches('[role="grid"], [role="table"], table')
        ? [container as HTMLElement]
        : []),
      ...container.querySelectorAll<HTMLElement>('[role="grid"], [role="table"], table')
    ].filter(
      (grid) =>
        visible(grid) && !grid.parentElement?.closest('[role="grid"], [role="table"], table')
    )
    for (const grid of grids) {
      const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"], tr')].filter(
        (row) => row.closest('[role="grid"], [role="table"], table') === grid && visible(row)
      )
      const headerRow = rows.find((row) => ownCells(row, '[role="columnheader"], th').length > 1)
      if (!headerRow) continue
      const headerCells = ownCells(headerRow, '[role="columnheader"], th').filter(visible)
      const headers = headerCells.map((cell) => {
        const box = cellBox(cell)
        const label = words(cell)
          .map((item) => item.word)
          .join(' ')
        return { label, left: box.left, width: box.width }
      })
      const crushed: string[] = []
      headerCells.forEach((cell, index) => {
        const label = headers[index]?.label ?? ''
        if (!label) return
        const style = getComputedStyle(cell)
        const content =
          cell.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        let widest = 0
        for (const { word, owner } of words(cell)) {
          const ownerStyle = getComputedStyle(owner)
          measure.style.font = ownerStyle.font
          measure.style.letterSpacing = ownerStyle.letterSpacing
          measure.style.textTransform = ownerStyle.textTransform
          measure.textContent = word
          widest = Math.max(widest, measure.getBoundingClientRect().width)
        }
        const clipped = [cell, ...cell.querySelectorAll<HTMLElement>('*')].find((element) => {
          if (hidden(element)) return false
          const style = getComputedStyle(element)
          return (
            (element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') ||
            (element.scrollHeight > element.clientHeight + 1 && style.overflowY === 'hidden')
          )
        })
        if (clipped) {
          crushed.push(
            `${index + 1}:${label} (.${clipped.className || clipped.tagName} clips ${clipped.scrollWidth}px to ${clipped.clientWidth}px)`
          )
        } else if (widest > content + 1) {
          crushed.push(
            `${index + 1}:${label} (${Math.round(widest)}px word in ${Math.round(content)}px)`
          )
        }
      })
      const misaligned: string[] = []
      let bodyRows = 0
      for (const row of rows) {
        if (row === headerRow) continue
        const cells = ownCells(
          row,
          '[role="gridcell"], [role="cell"], [role="rowheader"], td, th'
        ).filter(visible)
        if (cells.length !== headerCells.length) continue
        bodyRows += 1
        cells.forEach((cell, index) => {
          const header = headers[index]
          if (!header) return
          const box = cellBox(cell)
          if (Math.abs(box.left - header.left) > 2 || Math.abs(box.width - header.width) > 2) {
            misaligned.push(
              `row ${bodyRows} col ${index + 1} (${header.label}): ${Math.round(box.left)}/${Math.round(box.width)} vs ${Math.round(header.left)}/${Math.round(header.width)}`
            )
          }
        })
      }
      reports.push({
        name: grid.getAttribute('aria-label') ?? grid.className ?? grid.tagName,
        headers,
        misaligned,
        crushed,
        rows: bodyRows
      })
    }
    measure.remove()
    return reports
  }, scope)
}
