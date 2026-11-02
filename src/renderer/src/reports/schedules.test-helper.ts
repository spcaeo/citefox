import { fireEvent, within } from '@testing-library/react'

type Scope = ReturnType<typeof within>

/** Picks a Scheduled reports tab by its label (the count follows it). */
export function openTab(body: Scope, name: 'Schedules' | 'Delivery history' | 'All sends'): void {
  fireEvent.click(body.getByRole('tab', { name: new RegExp(`^${name}`) }))
}

/** Opens a row's `⋯` menu (named "Actions for …") and returns one of its items. */
export function menuItem(body: Scope, menu: string | RegExp, item: string): HTMLElement {
  fireEvent.click(body.getByRole('button', { name: menu }))
  return within(document.body).getByRole('menuitem', { name: item })
}
