export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'text' | 'danger'
export type ButtonSize = 'md' | 'sm'

/** Class list for a v2 button, for elements that are not a `<button>` (links). */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string
): string {
  return ['ui-btn', `ui-btn-${variant}`, size === 'sm' ? 'ui-btn-sm' : '', extra ?? '']
    .filter(Boolean)
    .join(' ')
}

/**
 * What a card's message is (Tints.dc.html): a win, something that needs a
 * look, or an AI suggestion. Plain data (tables, forms, KPI strips) has none.
 */
export type CardTint = 'win' | 'attention' | 'ai'

/** A card's class and `data-tint` for the .ui-tint utility (theme.css); no tint, no change. */
export function tintProps(
  className: string,
  tint: CardTint | null | undefined
): { className: string; 'data-tint'?: CardTint } {
  return tint ? { className: `${className} ui-tint`, 'data-tint': tint } : { className }
}
