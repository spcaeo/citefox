import { useEffect, useState } from 'react'

/** How often the corner is looked at again while the console shows (screens change under it). */
const RECHECK_MS = 1000

/**
 * The height of a sticky or fixed footer under the bottom-right corner (the
 * onboarding and first-run footers), so the console and its pill sit above
 * that footer's buttons instead of covering them. 0 when the corner is free.
 */
export function bottomClearance(): number {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return 0
  const height = window.innerHeight
  for (const element of document.elementsFromPoint(window.innerWidth - 32, height - 8)) {
    if (element.closest('[data-work-console]')) continue
    for (let node: Element | null = element; node && node !== document.body;) {
      const position = getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky') {
        const clear = Math.ceil(height - node.getBoundingClientRect().top)
        return clear > 0 && clear < height / 3 ? clear : 0
      }
      node = node.parentElement
    }
    return 0
  }
  return 0
}

/** {@link bottomClearance}, kept current while `on`. */
export function useBottomClearance(on: boolean): number {
  const [clear, setClear] = useState(0)
  useEffect(() => {
    if (!on) return
    const measure = (): void => setClear(bottomClearance())
    const first = window.setTimeout(measure, 0)
    const timer = window.setInterval(measure, RECHECK_MS)
    window.addEventListener('resize', measure)
    window.addEventListener('hashchange', measure)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('hashchange', measure)
    }
  }, [on])
  return clear
}
