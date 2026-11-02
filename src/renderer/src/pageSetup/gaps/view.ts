import { focusedPromptId } from '../gapsFilter'

/** The Content gaps views (sub-tabs). */
export const GAP_VIEWS = ['matrix', 'one', 'fixes'] as const

export type GapView = (typeof GAP_VIEWS)[number]

/**
 * The view a route focus asks for: `row:<promptId>` opens that prompt one by
 * one; `view:one` and `view:fixes` open those tabs; anything else is the matrix.
 */
export function viewFromFocus(focus: string | null): GapView {
  if (focusedPromptId(focus) !== null) return 'one'
  if (focus === 'view:one') return 'one'
  if (focus === 'view:fixes') return 'fixes'
  return 'matrix'
}

/** The route filter for a view (the matrix is the default and has none). */
export function focusForView(view: GapView): string | null {
  return view === 'matrix' ? null : `view:${view}`
}
