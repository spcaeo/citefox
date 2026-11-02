import type { AiEntityRef } from './types'
import { useAiContext } from './useAiContext'

/**
 * Tells Ask CiteFox which rows are ticked. ListGrid keeps its ticks inside;
 * only its bulk bar sees them, and the bar shows only while rows are ticked,
 * so a screen renders this inside its bulk bar: mounted, it adds the rows to
 * the screen's selection; gone, the selection is empty again.
 */
export function AiSelection({ items }: { items: readonly AiEntityRef[] }): null {
  useAiContext({ selection: items })
  return null
}
