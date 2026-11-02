import { REPORT_KPI_LABELS } from '@shared/report-copy'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_SCRIPT, renderHtmlReport } from '.'
import type { ReportModel } from '../model/types'
import { fullReportModel } from './report-model.test-helper'

/**
 * The drawer's drill steps in happy-dom: list -> answer -> site, Back, the trail, Escape
 * one level, a URL per view, restoring a view from its address, Copy link and Copy all
 * URLs. The real-browser run is tests/e2e/report-drill.spec.ts.
 */

const windows: Window[] = []

afterEach(() => {
  for (const window of windows.splice(0)) void window.happyDOM.close()
})

interface Page {
  window: Window
  document: Window['document']
  copied: string[]
  blobs: Blob[]
}

function open(
  options: { hash?: string; model?: ReportModel; clipboard?: 'ok' | 'blocked' } = {}
): Page {
  const html = renderHtmlReport(options.model ?? fullReportModel(), { secrets: [] })
  const window = new Window({
    url: `https://report.local/index.html${options.hash ?? ''}`,
    width: 1280,
    height: 900
  })
  windows.push(window)
  window.document.write(html.replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
  const copied: string[] = []
  const clipboard = {
    writeText: (text: string): Promise<void> => {
      if (options.clipboard === 'blocked') return Promise.reject(new Error('blocked'))
      copied.push(text)
      return Promise.resolve()
    }
  }
  Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true })
  ;(window.document as unknown as { execCommand: () => boolean }).execCommand = () => false
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
  window.eval(CLIENT_SCRIPT)
  return { window, document: window.document, copied, blobs }
}

function el<T = HTMLElement>(page: Page, selector: string): T {
  const found = page.document.querySelector(selector)
  if (found === null) throw new Error(`${selector} is missing`)
  return found as unknown as T
}

function press(page: Page, key: string): void {
  page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true }))
}

function title(page: Page): string {
  return page.document.getElementById('drawer-title')?.textContent ?? ''
}

function hash(page: Page): string {
  return decodeURIComponent(page.window.location.hash)
}

function drawerHidden(page: Page): boolean {
  return el<HTMLElement>(page, '#drawer').hidden
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A row that cites at least one other site, and that site. */
function citingRow(): { id: string; domain: string; text: string } {
  const model = fullReportModel()
  for (const row of model.rows) {
    const ref = model.references.find(
      (item) => item.rowId === row.id && item.classification === 'other'
    )
    if (row.aio && ref !== undefined) return { id: row.id, domain: ref.domain, text: row.text }
  }
  throw new Error('the sample has no row citing another site')
}

describe('drill steps in the drawer', () => {
  test('list -> answer -> site, with a trail, Back, and Escape one level at a time', () => {
    const page = open()
    const { id, domain, text } = citingRow()
    const kpi = el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]')
    kpi.focus()
    kpi.click()
    expect(hash(page)).toBe('#d=l:all')
    expect(el<HTMLElement>(page, '#drawer-back').hidden).toBe(true)
    expect(el<HTMLElement>(page, '#drawer-trail').hidden).toBe(true)

    // Level 2: the prompt's answer.
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="q:${id}"]`).click()
    expect(title(page)).toBe(text)
    expect(hash(page)).toBe(`#d=l:all&d=q:${id}`)
    expect(page.document.activeElement?.id).toBe('drawer-title')
    expect(el<HTMLElement>(page, '#drawer-back').hidden).toBe(false)
    expect(page.document.querySelectorAll('#drawer-trail li')).toHaveLength(2)
    expect(
      page.document.querySelector('#drawer-body .answer')?.textContent?.length
    ).toBeGreaterThan(10)
    const sites = page.document.querySelectorAll('#drawer-body table.drawer-refs tbody tr')
    expect(sites.length).toBeGreaterThan(0)

    // Level 3: the prompts citing that site.
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="dom:${domain}"]`).click()
    expect(title(page)).toBe(domain)
    expect(hash(page)).toBe(`#d=l:all&d=q:${id}&d=dom:${domain}`)
    expect(page.document.querySelectorAll('#drawer-trail li')).toHaveLength(3)
    const listed = [...page.document.querySelectorAll('#drawer-body table.drawer-table tbody tr')]
    expect(listed.map((row) => row.getAttribute('data-row-id'))).toContain(id)

    // Back pops one level and puts focus on the button that opened the step.
    el<HTMLButtonElement>(page, '#drawer-back').click()
    expect(title(page)).toBe(text)
    expect(page.document.activeElement?.getAttribute('data-open')).toBe(`dom:${domain}`)
    expect(hash(page)).toBe(`#d=l:all&d=q:${id}`)

    // Escape closes one level, then the drawer, and focus returns to the KPI.
    press(page, 'Escape')
    expect(title(page)).toBe(REPORT_KPI_LABELS.tracked)
    press(page, 'Escape')
    expect(drawerHidden(page)).toBe(true)
    expect(page.document.activeElement).toBe(kpi)
    expect(hash(page)).toBe('')
  })

  test('the trail jumps back several levels; Close shuts every level', () => {
    const page = open()
    const { id, domain } = citingRow()
    el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]').click()
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="q:${id}"]`).click()
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="dom:${domain}"]`).click()
    el<HTMLButtonElement>(page, '#drawer-trail button[data-trail="1"]').click()
    expect(hash(page)).toBe('#d=l:all')
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="q:${id}"]`).click()
    el<HTMLButtonElement>(page, '#drawer-close').click()
    expect(drawerHidden(page)).toBe(true)
    expect(hash(page)).toBe('')
  })

  test('a whole row opens its answer, and a page cell opens the page with its prompts', () => {
    const page = open()
    el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]').click()
    const row = el<HTMLElement>(page, '#drawer-body tbody tr[data-open]')
    const rowId = row.getAttribute('data-row-id') ?? ''
    el<HTMLElement>(page, '#drawer-body tbody tr[data-open] td.center').click()
    expect(hash(page)).toBe(`#d=l:all&d=q:${rowId}`)
    const pageButton = el<HTMLButtonElement>(page, '#drawer-body button[data-open^="p:"]')
    pageButton.click()
    expect(title(page)).toMatch(/^\//)
    expect(page.document.getElementById('drawer-sub')?.textContent).toMatch(/checked for this page/)
    expect(el<HTMLElement>(page, '#drawer-urls').hidden).toBe(false)
  })

  test('a prompt cell in the section table and the leaderboard domain open their steps', () => {
    const page = open()
    el<HTMLButtonElement>(page, '[data-table-id="prompts"] button[data-open^="q:"]').click()
    expect(el<HTMLElement>(page, '#drawer .q-facts')).toBeTruthy()
    press(page, 'Escape')
    el<HTMLButtonElement>(page, '[data-table-id="leaderboard"] button[data-open^="dom:"]').click()
    expect(
      page.document.querySelectorAll('#drawer-body table.drawer-table tbody tr').length
    ).toBeGreaterThan(0)
  })
})

describe('every view has an address', () => {
  test('opening the file with a drill address restores all its levels', () => {
    const { id, domain } = citingRow()
    const page = open({ hash: `#s=competition&d=l:all&d=q:${id}&d=dom:${domain}` })
    expect(drawerHidden(page)).toBe(false)
    expect(title(page)).toBe(domain)
    expect(page.document.querySelectorAll('#drawer-trail li')).toHaveLength(3)
    el<HTMLButtonElement>(page, '#drawer-back').click()
    expect(page.document.querySelector('#drawer-body .q-facts')).not.toBeNull()
  })

  test('browser Back and Forward walk through the drawer steps', async () => {
    const page = open()
    const { id } = citingRow()
    el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]').click()
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="q:${id}"]`).click()
    page.window.history.back()
    await settle()
    page.window.dispatchEvent(new page.window.PopStateEvent('popstate'))
    expect(hash(page)).toBe('#d=l:all')
    expect(title(page)).toBe(REPORT_KPI_LABELS.tracked)
    page.window.history.forward()
    await settle()
    page.window.dispatchEvent(new page.window.PopStateEvent('popstate'))
    expect(title(page)).not.toBe(REPORT_KPI_LABELS.tracked)
  })

  test('filters and segment chips live in the address and come back from it', () => {
    const page = open()
    const input = el<HTMLInputElement>(page, '[data-filter="prompts"]')
    input.value = 'twilio'
    ;(input as unknown as { dispatchEvent: (event: unknown) => boolean }).dispatchEvent(
      new page.window.Event('input', { bubbles: true })
    )
    expect(hash(page)).toBe('#f=prompts:twilio')

    const again = open({ hash: '#f=prompts:twilio' })
    expect(el<HTMLInputElement>(again, '[data-filter="prompts"]').value).toBe('twilio')
    const visible = [
      ...again.document.querySelectorAll('[data-table-wrap="prompts"] tbody tr')
    ].filter((row) => !(row as unknown as HTMLElement).hidden)
    expect(visible.length).toBeGreaterThan(0)
    for (const row of visible) expect(row.textContent?.toLowerCase()).toContain('twilio')
  })

  test('a broken or unknown address opens the plain report', () => {
    const page = open({ hash: '#d=q:nope&d=dom:no-such-site.example&d=l:no-token' })
    expect(drawerHidden(page)).toBe(true)
    expect(page.document.querySelector('#drawer-body')?.textContent).toBe('')
  })

  test('Copy link copies the address of the current view', async () => {
    const page = open()
    el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]').click()
    el<HTMLButtonElement>(page, '#drawer-link').click()
    await settle()
    expect(page.copied).toEqual(['https://report.local/index.html#d=l:all'])
    expect(page.document.getElementById('toast')?.textContent).toBe('Link copied')
  })

  test('when copying is blocked, the text is shown selected in a box', async () => {
    const page = open({ clipboard: 'blocked' })
    el<HTMLButtonElement>(page, '#copy-view').click()
    await settle()
    const box = el<HTMLElement>(page, '#copy-box')
    expect(box.hidden).toBe(false)
    expect(el<HTMLTextAreaElement>(page, '#copy-text').value).toBe(
      'https://report.local/index.html'
    )
    press(page, 'Escape')
    expect(box.hidden).toBe(true)
  })

  test('Copy all URLs copies a table’s page URLs, one per line', async () => {
    const page = open()
    el<HTMLButtonElement>(page, '.urls-btn[data-table="tracked-pages"]').click()
    await settle()
    expect(page.copied).toHaveLength(1)
    for (const line of page.copied[0]!.split('\n')) expect(line).toMatch(/^https?:\/\//)
  })

  test('the drawer CSV holds the rows of the current step', async () => {
    const page = open()
    const { id } = citingRow()
    el<HTMLButtonElement>(page, '.kpi .drill[data-drill="all"]').click()
    el<HTMLButtonElement>(page, `#drawer-body button[data-open="q:${id}"]`).click()
    el<HTMLButtonElement>(page, '#drawer-csv').click()
    const text = new TextDecoder().decode(
      new Uint8Array(await page.blobs[0]!.arrayBuffer()).slice(3)
    )
    const lines = text.split('\r\n').filter((line) => line.length > 0)
    expect(lines[0]).toBe('"Position","Site","Cited page","Title","Kind"')
    expect(lines.length - 1).toBe(
      page.document.querySelectorAll('#drawer-body table.drawer-refs tbody tr').length
    )
  })
})
