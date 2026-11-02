import { useLayoutEffect, useState } from 'react'

/**
 * An `aria-label` that starts with the control's visible text (WCAG 2.5.3
 * "label in name"): "67 — Avg score of Alpha: show each page's score". A label
 * that already contains the visible text is used as it is. Pass `attach` as the
 * control's `ref`; it follows the control's text as it changes.
 */
export function useTextLabel<T extends HTMLElement>(
  label: string | undefined
): readonly [ariaLabel: string | undefined, attach: (node: T | null) => void] {
  const [node, setNode] = useState<T | null>(null)
  const [text, setText] = useState('')
  useLayoutEffect(() => {
    if (!node) return
    const read = (): void => setText(visibleText(node))
    read()
    const observer = new MutationObserver(read)
    observer.observe(node, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [node])
  return [labelWithText(label, text), setNode] as const
}

function visibleText(node: HTMLElement): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** `label`, led by `text` unless it already contains it. */
export function labelWithText(label: string | undefined, text: string): string | undefined {
  if (!label) return undefined
  if (!text || label.toLowerCase().includes(text.toLowerCase())) return label
  return `${text} — ${label}`
}
