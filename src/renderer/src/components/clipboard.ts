/**
 * Writes `text` to the clipboard. Uses the async Clipboard API when the page
 * has it, then falls back to a hidden text area and `execCommand('copy')`.
 * Resolves false when neither worked.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or no focus. Try the fallback below.
    }
  }
  return copyWithTextArea(text)
}

function copyWithTextArea(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.dataset.clipboard = ''
  area.style.position = 'fixed'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.append(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    active?.focus()
  }
}
