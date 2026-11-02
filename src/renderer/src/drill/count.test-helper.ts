import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * NFR-14 in the renderer tests: every number marked `data-nfr-drill` inside
 * `root` opens the drill drawer on the URL (`drawer=drill&drill=<id>`), and the
 * drawer lists exactly as many rows as the number (`data-nfr-figure`) says.
 */

/** The rows the open drill drawer lists in all ("Show all" first when it holds more than 100). */
export async function drillDrawerRows(dialog: HTMLElement): Promise<number> {
  const more = within(dialog).queryByRole('button', { name: /^Show all \d/ })
  if (more) fireEvent.click(more)
  const grid = within(dialog).queryByRole('grid')
  if (grid === null) return 0
  await waitFor(() => expect(grid.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0))
  return Number(grid.getAttribute('aria-rowcount')) - 1
}

/** The number a drill control shows. */
export function drillFigure(control: Element): number {
  const id = control.getAttribute('data-nfr-drill') ?? ''
  const figure =
    control.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`) ??
    control.ownerDocument.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`)
  return Number((figure?.textContent ?? '').replace(/[,\s]/g, ''))
}

/**
 * Clicks one drill control and checks the drawer: on the URL, as many rows as
 * the number. Closes it with Escape. Returns the id and the count.
 */
export async function expectDrillMatches(
  control: HTMLElement
): Promise<{ id: string; count: number }> {
  const id = control.getAttribute('data-nfr-drill') ?? ''
  const count = drillFigure(control)
  expect(Number.isInteger(count), `${id} shows a number`).toBe(true)
  fireEvent.click(control)
  const dialog = await waitFor(() => {
    const open = document.querySelector<HTMLElement>(`[role="dialog"][data-drill="${id}"]`)
    expect(open, `${id} opens its drawer`).not.toBeNull()
    return open as HTMLElement
  })
  await waitFor(() =>
    expect(decodeURIComponent(window.location.hash)).toContain(`drawer=drill&drill=${id}`)
  )
  expect(await drillDrawerRows(dialog), id).toBe(count)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(document.querySelector('[role="dialog"][data-drill]')).toBeNull())
  return { id, count }
}

/** Every drill control in `root`, each checked with `expectDrillMatches`. */
export async function expectEveryDrillMatches(
  root: HTMLElement
): Promise<{ id: string; count: number }[]> {
  const ids = [
    ...new Set(
      [...root.querySelectorAll<HTMLElement>('[data-nfr-drill]')].map(
        (node) => node.getAttribute('data-nfr-drill') ?? ''
      )
    )
  ]
  const opened: { id: string; count: number }[] = []
  for (const id of ids) {
    const control = root.querySelector<HTMLElement>(`[data-nfr-drill="${CSS.escape(id)}"]`)
    if (control) opened.push(await expectDrillMatches(control))
  }
  return opened
}
