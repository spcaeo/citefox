/**
 * Shared rules for lists whose rows open on Enter and on click.
 * A row opens only when the event belongs to the row itself, never when it
 * comes from a link, button, checkbox or field inside the row: those keep
 * their own Enter, Space and click behaviour.
 */

const CONTROLS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[contenteditable="true"]',
  '[data-no-row-open]'
].join(', ')

/** True when `target` is, or sits inside, a control that lives inside `row`. */
export function fromControl(target: EventTarget | null, row: Element): boolean {
  if (!(target instanceof Element)) return false
  const control = target.closest(CONTROLS)
  return control !== null && control !== row && row.contains(control)
}

/** True while the user has text selected, so a drag-select is not read as a row click. */
export function selectingText(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString().trim().length > 0
}

/**
 * The row element a click landed in, when the click should open that row:
 * not from a control inside it, and not the end of a text selection.
 */
export function clickedRow(target: EventTarget | null, attribute: string): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const row = target.closest<HTMLElement>(`[${attribute}]`)
  if (!row || fromControl(target, row) || selectingText()) return null
  return row
}
