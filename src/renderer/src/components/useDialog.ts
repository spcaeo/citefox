import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLatest } from './useLatest'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/**
 * Open dialogs, drawers and menus, oldest first. Only the newest one answers
 * Escape and traps Tab, so a drawer opened from a side panel closes alone.
 */
const openStack: symbol[] = []

export interface DialogOptions {
  /** Called on Escape. May change on every render; the latest one is used. */
  onClose: () => void
  /** False while the dialog or menu is closed. Default true (mounted means open). */
  active?: boolean
  /** Keep Tab and Shift+Tab inside the element. Default true. Use false for popovers and menus. */
  trap?: boolean
  /** Focus the element that was focused before opening, on close. Default true. */
  restoreFocus?: boolean
  /** Where focus goes on open. Default: `[data-autofocus]`, else the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>
  /** When this changes while open, focus moves to the initial element again (new content). */
  focusKey?: unknown
}

/**
 * Shared keyboard behaviour for dialogs, drawers, popovers, and menus:
 * focus moves in on open, Tab is trapped (when `trap`), Escape calls
 * `onClose`, and focus goes back to the opener on close.
 * Returns the ref for the dialog element.
 */
export function useDialog<T extends HTMLElement>(options: DialogOptions): RefObject<T | null> {
  const root = useRef<T>(null)
  const active = options.active ?? true
  const latest = useLatest(options)

  // A layout effect: Escape and Tab work from the first frame the dialog is on
  // screen, not one paint later (a quick Escape right after opening was lost).
  useLayoutEffect(() => {
    if (!active) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = Symbol('dialog')
    openStack.push(id)

    function onKey(event: KeyboardEvent): void {
      if (openStack[openStack.length - 1] !== id) return
      if (event.key === 'Escape') {
        event.preventDefault()
        latest.current.onClose()
        return
      }
      if (event.key !== 'Tab' || latest.current.trap === false) return
      const node = root.current
      if (!node) return
      const items = focusableIn(node)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const current = document.activeElement
      if (!(current instanceof Node) || !node.contains(current)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function restore(): void {
      if (latest.current.restoreFocus !== false && opener?.isConnected) opener.focus()
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openStack.indexOf(id)
      if (at >= 0) openStack.splice(at, 1)
      restore()
    }
  }, [active, latest])

  const focusKey = options.focusKey
  useEffect(() => {
    if (!active) return
    const node = root.current
    if (!node) return
    const target =
      latest.current.initialFocus?.current ??
      node.querySelector<HTMLElement>('[data-autofocus]') ??
      focusableIn(node)[0] ??
      null
    target?.focus()
  }, [active, focusKey, latest])

  return root
}

function focusableIn(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-hidden') !== 'true'
  )
}
