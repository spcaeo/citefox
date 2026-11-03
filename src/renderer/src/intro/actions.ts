export const INTRO_DIALOG = 'intro'

/** Opens the welcome tour on its URL (`?dialog=intro`), keeping the screen underneath. */
export function openTour(): void {
  const [path = '#/', query = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(query)
  params.set('dialog', INTRO_DIALOG)
  window.location.hash = `${path || '#/'}?${params.toString()}`
}

/** Closes the replay: the same URL without `dialog=intro`. */
export function closeTour(): void {
  const [path = '#/', query = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(query)
  if (params.get('dialog') !== INTRO_DIALOG) return
  params.delete('dialog')
  const rest = params.toString()
  window.location.hash = rest.length > 0 ? `${path}?${rest}` : path || '#/'
}

export function tourOpenInUrl(hash: string): boolean {
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('dialog') === INTRO_DIALOG
}
