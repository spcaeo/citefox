import { Window } from 'happy-dom'
import { afterEach, describe, expect, test } from 'vitest'
import { CLIENT_SCRIPT, renderHtmlReport } from '.'
import type { ReportModel } from '../model/types'
import { fullReportModel } from './report-model.test-helper'

/**
 * Guard against a cell that prints a value instead of text: "[object HTMLButtonElement]"
 * (a DOM node or nested array pushed into a template), "undefined" or "NaN". Renders
 * every section, then opens every drill and every drawer step (answers, pages, sites)
 * and scans all visible text and every attribute.
 */

const BAD = /\[object|\bundefined\b|\bNaN\b/

const windows: Window[] = []
afterEach(() => {
  for (const window of windows.splice(0)) void window.happyDOM.close()
})

interface Loaded {
  window: Window
  document: Window['document']
}

function load(model: ReportModel): Loaded {
  const html = renderHtmlReport(model, { secrets: [] })
  const window = new Window({ url: 'https://report.local/index.html', width: 1280, height: 900 })
  windows.push(window)
  window.document.write(html.replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
  window.eval(CLIENT_SCRIPT)
  return { window, document: window.document }
}

/** Every bad text node or attribute under `root`, with where it was found. */
function problems(root: Element, where: string): string[] {
  const found: string[] = []
  const walk = (node: Element): void => {
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return
    for (const attr of [...node.attributes]) {
      if (BAD.test(attr.value))
        found.push(`${where}: <${node.tagName.toLowerCase()} ${attr.name}="${attr.value}">`)
    }
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3 && BAD.test(child.textContent ?? '')) {
        found.push(
          `${where}: "${(child.textContent ?? '').trim().slice(0, 80)}" in <${node.tagName.toLowerCase()}>`
        )
      }
      if (child.nodeType === 1) walk(child as unknown as Element)
    }
  }
  walk(root)
  return found
}

function click(button: unknown): void {
  ;(button as HTMLButtonElement).click()
}

function closeAll(page: Loaded): void {
  const close = page.document.getElementById('drawer-close')
  if (
    close !== null &&
    !(page.document.getElementById('drawer') as unknown as HTMLElement).hidden
  ) {
    click(close)
  }
}

const MODELS: [string, () => ReportModel][] = [
  ['page scope', () => fullReportModel()],
  ['project scope', () => fullReportModel({ scope: 'project', pageIds: [] })]
]

describe.each(MODELS)('no cell prints an object (%s)', (_name, makeModel) => {
  test('the CSV data behind every table holds only text, numbers and blanks', () => {
    const html = renderHtmlReport(makeModel(), { secrets: [] })
    const json = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html
    )?.[1]
    const data = JSON.parse(json ?? '{}') as {
      tables: Record<string, { columns: unknown[]; rows: unknown[][]; urls?: unknown[] }>
    }
    const tables = Object.entries(data.tables)
    expect(tables.length).toBeGreaterThan(10)
    for (const [id, table] of tables) {
      for (const column of table.columns) expect(typeof column, id).toBe('string')
      for (const row of table.rows) {
        expect(row.length, id).toBe(table.columns.length)
        for (const cell of row) {
          expect(
            cell === null || typeof cell === 'string' || typeof cell === 'number',
            `${id}: ${String(cell)}`
          ).toBe(true)
          if (typeof cell === 'string') expect(cell, id).not.toMatch(BAD)
          if (typeof cell === 'number') expect(Number.isFinite(cell), id).toBe(true)
        }
      }
      for (const url of table.urls ?? []) expect(url, id).toMatch(/^https?:\/\//)
    }
  })

  test('every section, table cell and chart renders text only', () => {
    const page = load(makeModel())
    const main = page.document.getElementById('main') as unknown as Element
    expect(page.document.querySelectorAll('main td').length).toBeGreaterThan(100)
    expect(problems(main, 'page')).toEqual([])
  })

  test('every drill and every drawer step renders text only', () => {
    const page = load(makeModel())
    const drawer = page.document.getElementById('drawer') as unknown as Element
    const found: string[] = []
    const drills = [...page.document.querySelectorAll('main button.drill, main button[data-open]')]
    expect(drills.length).toBeGreaterThan(80)
    const steps = new Set<string>()
    for (const button of drills) {
      closeAll(page)
      click(button)
      found.push(
        ...problems(
          drawer,
          button.getAttribute('data-drill') ?? button.getAttribute('data-open') ?? '?'
        )
      )
      for (const next of page.document.querySelectorAll('#drawer-body button[data-open]')) {
        steps.add(next.getAttribute('data-open') ?? '')
      }
    }
    // Second and third levels: each answer, page and site reachable from the lists.
    const seen = new Set<string>()
    const queue = [...steps]
    while (queue.length > 0) {
      const entry = queue.shift() ?? ''
      if (seen.has(entry)) continue
      seen.add(entry)
      closeAll(page)
      const opener = page.document.createElement('button')
      opener.setAttribute('data-open', entry)
      opener.setAttribute('type', 'button')
      ;(page.document.getElementById('drawer-body') as unknown as Node).appendChild(
        opener as unknown as Node
      )
      click(opener)
      opener.remove()
      found.push(...problems(drawer, entry))
      for (const next of page.document.querySelectorAll('#drawer-body button[data-open]')) {
        const value = next.getAttribute('data-open') ?? ''
        if (!seen.has(value)) queue.push(value)
      }
    }
    expect(seen.size).toBeGreaterThan(20)
    expect([...seen].some((entry) => entry.startsWith('q:'))).toBe(true)
    expect([...seen].some((entry) => entry.startsWith('dom:'))).toBe(true)
    expect([...seen].some((entry) => entry.startsWith('p:'))).toBe(true)
    expect(found).toEqual([])
    // Clicks every number in the report: slow when the whole suite runs at once.
  }, 20_000)
})
