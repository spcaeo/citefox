import { Window } from 'happy-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_SCRIPT, renderHtmlReport } from '.'
import { fullReportModel } from './report-model.test-helper'

/**
 * Runs the report's browser script against the rendered page in happy-dom: drawer,
 * focus return, search, CSV, "Show all", sorting, focus mode and print expansion.
 * The real-browser run (CSP, downloads, print media) is tests/e2e/report-html.spec.ts.
 */

const windows: Window[] = []

afterEach(() => {
  for (const window of windows.splice(0)) void window.happyDOM.close()
})

interface Page {
  window: Window
  document: Window['document']
  blobs: Blob[]
  print: ReturnType<typeof vi.fn>
}

function open(): Page {
  const html = renderHtmlReport(fullReportModel(), { secrets: [] })
  const window = new Window({ url: 'https://report.local/index.html', width: 1280, height: 900 })
  windows.push(window)
  // The app script runs once, below, so the page's own copy is left out.
  window.document.write(html.replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
  const blobs: Blob[] = []
  const url = window.URL as unknown as {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
  }
  url.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:https://report.local/1'
  })
  url.revokeObjectURL = vi.fn()
  const print = vi.fn()
  ;(window as unknown as { print: () => void }).print = print
  window.eval(CLIENT_SCRIPT)
  return { window, document: window.document, blobs, print }
}

function button(page: Page, selector: string): HTMLButtonElement {
  const element = page.document.querySelector(selector)
  if (element === null) throw new Error(`${selector} is missing`)
  return element as unknown as HTMLButtonElement
}

function fire(target: unknown, event: unknown): void {
  ;(target as { dispatchEvent: (event: unknown) => boolean }).dispatchEvent(event)
}

function press(page: Page, key: string): void {
  page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('HTML report script', () => {
  test('marks the page as scripted and collapses long tables', () => {
    const page = open()
    expect(page.document.documentElement.classList.contains('js')).toBe(true)
    expect(
      page.document.querySelector('[data-table-wrap="prompts"]')?.classList.contains('collapsed')
    ).toBe(true)
  })

  test('a drill opens the drawer with exactly n rows; Escape closes it and focus returns', () => {
    const page = open()
    const drill = button(page, '.kpi .drill[data-drill="aio:shown"]')
    const n = Number(drill.getAttribute('data-n'))
    drill.focus()
    drill.click()
    const drawer = page.document.getElementById('drawer') as unknown as HTMLElement | null
    expect(drawer?.hidden).toBe(false)
    expect(drawer?.getAttribute('role')).toBe('dialog')
    expect(drawer?.getAttribute('aria-modal')).toBe('true')
    expect(page.document.getElementById('drawer-title')?.textContent).toBe('AI Overview appears')
    expect(page.document.querySelectorAll('#drawer-body tbody tr')).toHaveLength(n)
    expect(page.document.querySelector('[data-testid="drawer-summary"]')?.textContent).toContain(
      `Questions${n}`
    )
    expect(page.document.activeElement?.id).toBe('drawer-title')
    expect(page.document.getElementById('app')?.hasAttribute('inert')).toBe(true)
    press(page, 'Escape')
    expect(drawer?.hidden).toBe(true)
    expect(page.document.activeElement).toBe(drill)
  })

  test(
    'every drill button opens a drawer whose row count equals its number',
    { timeout: 15_000 },
    () => {
      const page = open()
      const drills = [
        ...page.document.querySelectorAll('button.drill')
      ] as unknown as HTMLButtonElement[]
      expect(drills.length).toBeGreaterThan(80)
      for (const drill of drills) {
        drill.click()
        expect(
          page.document.querySelectorAll('#drawer-body tbody tr').length,
          drill.getAttribute('data-drill') ?? ''
        ).toBe(Number(drill.textContent))
        press(page, 'Escape')
      }
    }
  )

  test('stored text in the drawer is escaped', () => {
    const page = open()
    button(page, '.kpi .drill[data-drill="all"]').click()
    expect(page.document.querySelector('#drawer-body img, #drawer-body script')).toBeNull()
  })

  test('search counts matches live and opens the drawer on Enter', () => {
    const page = open()
    const search = page.document.getElementById('search') as unknown as HTMLInputElement
    search.value = 'Verizon'
    fire(search, new page.window.Event('input', { bubbles: true }))
    expect(page.document.getElementById('search-status')?.textContent).toBe(
      '2 questions match. Press Enter to see them.'
    )
    fire(search, new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect((page.document.getElementById('drawer') as unknown as HTMLElement).hidden).toBe(false)
    expect(page.document.querySelectorAll('#drawer-body tbody tr')).toHaveLength(2)
    expect(page.document.getElementById('drawer-title')?.textContent).toBe('Search: “Verizon”')
  })

  test('CSV builds a UTF-8 Blob with a BOM, CRLF, quoted cells and no formula injection', async () => {
    const page = open()
    button(page, '.csv-btn[data-table="prompts"]').click()
    expect(page.blobs).toHaveLength(1)
    const bytes = new Uint8Array(await page.blobs[0]!.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes.slice(3))
    const lines = text.split('\r\n')
    expect(lines[0]).toBe(
      '"#","Prompt","Stage","Source","Market","Status","AIO","Cited","Page cited","Named","Position","Top cited domains","Last checked"'
    )
    expect(lines.filter((line) => line.length > 0)).toHaveLength(21)
    expect(page.blobs[0]?.type).toBe('text/csv;charset=utf-8')
  })

  test('CSV cells that start like a formula are neutralised', async () => {
    const page = open()
    const data = JSON.parse(page.document.getElementById('report-data')?.textContent ?? '{}') as {
      tables: Record<string, { columns: string[]; rows: unknown[][] }>
    }
    expect(data.tables['leaderboard']).toBeDefined()
    // Re-run the script on a table whose cells start with formula characters.
    const element = page.document.getElementById('report-data')
    if (element === null) throw new Error('report-data is missing')
    data.tables['leaderboard'] = {
      columns: ['A'],
      rows: [['=1+1'], ['+x'], ['-y'], ['@z'], ['\tq'], [-2], ['plain "q"']]
    }
    element.textContent = JSON.stringify(data)
    page.window.eval(CLIENT_SCRIPT)
    button(page, '.csv-btn[data-table="leaderboard"]').click()
    const blob = page.blobs[page.blobs.length - 1]
    const text = new TextDecoder().decode(new Uint8Array(await blob!.arrayBuffer()).slice(3))
    expect(text).toBe(
      `"A"\r\n"'=1+1"\r\n"'+x"\r\n"'-y"\r\n"'@z"\r\n"'\tq"\r\n-2\r\n"plain ""q"""\r\n`
    )
  })

  test('"Show all" expands a long table and the print handler expands every table', () => {
    const page = open()
    const wrap = page.document.querySelector('[data-table-wrap="prompts"]')
    const toggle = button(page, '.show-all[data-table="prompts"]')
    toggle.click()
    expect(wrap?.classList.contains('collapsed')).toBe(false)
    expect(toggle.textContent).toBe('Show fewer')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(wrap?.querySelector('.showing-text')?.textContent).toBe('Showing 20 of 20')
    toggle.click()
    expect(wrap?.classList.contains('collapsed')).toBe(true)
    page.window.dispatchEvent(new page.window.Event('beforeprint'))
    expect(page.document.querySelectorAll('[data-table-wrap].collapsed')).toHaveLength(0)
    page.window.dispatchEvent(new page.window.Event('afterprint'))
    expect(wrap?.classList.contains('collapsed')).toBe(true)
  })

  test('sorting reorders rows and sets aria-sort', () => {
    const page = open()
    const sort = button(page, '[data-table-id="leaderboard"] .sort[data-col="2"]')
    sort.click()
    const th = sort.closest('th')
    expect(th?.getAttribute('aria-sort')).toBe('ascending')
    const values = [
      ...page.document.querySelectorAll('[data-table-id="leaderboard"] tbody tr')
    ].map((row) => Number(row.querySelectorAll('td')[2]?.getAttribute('data-sort')))
    expect(values).toEqual([...values].sort((a, b) => a - b))
    sort.click()
    expect(th?.getAttribute('aria-sort')).toBe('descending')
  })

  test('the table filter shows matching rows only', () => {
    const page = open()
    const input = page.document.querySelector(
      '[data-filter="prompts"]'
    ) as unknown as HTMLInputElement
    input.value = 'twilio'
    fire(input, new page.window.Event('input', { bubbles: true }))
    const visible = [
      ...page.document.querySelectorAll('[data-table-wrap="prompts"] tbody tr')
    ].filter((row) => !(row as unknown as HTMLElement).hidden)
    expect(visible.length).toBeGreaterThan(0)
    for (const row of visible) expect(row.textContent?.toLowerCase()).toContain('twilio')
  })

  test('focus mode toggles the nav with aria-pressed; print calls window.print', () => {
    const page = open()
    const focus = button(page, '#focus-toggle')
    focus.click()
    expect(page.document.body.classList.contains('focus-mode')).toBe(true)
    expect(focus.getAttribute('aria-pressed')).toBe('true')
    focus.click()
    expect(focus.getAttribute('aria-pressed')).toBe('false')
    button(page, '#print-btn').click()
    expect(page.print).toHaveBeenCalledTimes(1)
  })

  test('the report opens light and the Dark button switches it, with aria-pressed', () => {
    const page = open()
    const root = page.document.documentElement
    expect(root.getAttribute('data-theme')).toBeNull()
    const dark = button(page, '#theme-toggle')
    dark.click()
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(dark.getAttribute('aria-pressed')).toBe('true')
    dark.click()
    expect(root.getAttribute('data-theme')).toBeNull()
    expect(dark.getAttribute('aria-pressed')).toBe('false')
  })
})
