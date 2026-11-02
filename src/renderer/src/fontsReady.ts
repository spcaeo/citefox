/**
 * Loads the bundled Inter, Inter Tight and JetBrains Mono faces before the
 * first render. They are local files, so this takes a few milliseconds; without
 * it, grids that size columns from measured text (the Results prompt grid)
 * measure the fallback font first and end up too narrow for Inter. Never waits
 * longer than `timeoutMs`.
 */
export function loadUiFonts(timeoutMs = 1500): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve()
  const faces = [
    '400 14px Inter',
    '600 14px Inter',
    '600 19px "Inter Tight"',
    '400 12px "JetBrains Mono"'
  ]
  const loaded = Promise.all(faces.map((face) => fonts.load(face).catch(() => []))).then(
    () => undefined
  )
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  return Promise.race([loaded, timeout])
}
