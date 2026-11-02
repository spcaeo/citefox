import type { ReportScope } from '@shared/domain'
import { resolveScopeIds, type ScopeOptions } from '../../../scope'
import { reportFormatFor, scheduleSeedParams } from '../../schedules/utils/scheduleUrl'
import { chosenSections, isPickKind, type ExportForm } from '../model'
import { viewPageIds } from './viewPages'

/**
 * The page (and topic) ids a pick kind covers, sent to main as `selected`.
 * A saved view runs its filter with All pages' own columns. Page and project
 * scopes resolve in main, so they give nothing here.
 */
export function resolveExportScope(form: ExportForm, options: ScopeOptions | null): string[] {
  if (options === null || !isPickKind(form.scope)) return []
  if (form.scope === 'view') {
    const rows = options.rows ?? []
    const out = new Set<string>()
    for (const view of options.views) {
      if (!form.ids.includes(view.id)) continue
      for (const id of viewPageIds(rows, options.markets, view.filter)) out.add(id)
    }
    return [...out]
  }
  return resolveScopeIds({ kind: form.scope, ids: form.ids }, options)
}

/** The schedule scope this export's scope becomes. A saved view is its pages today. */
export function reportScopeOf(
  form: ExportForm,
  context: { pageId: string | null; pageIsTopic: boolean; resolved: readonly string[] }
): ReportScope {
  switch (form.scope) {
    case 'page':
      return context.pageId
        ? { kind: context.pageIsTopic ? 'topic' : 'pages', ids: [context.pageId] }
        : { kind: 'project', ids: [] }
    case 'project':
      return { kind: 'project', ids: [] }
    case 'view':
      return context.resolved.length > 0
        ? { kind: 'pages', ids: [...context.resolved] }
        : { kind: 'project', ids: [] }
    default:
      return form.ids.length > 0
        ? { kind: form.scope, ids: [...form.ids] }
        : { kind: 'project', ids: [] }
  }
}

/** URL values that open a new schedule with this export's scope, sections, file and market. */
export function scheduleSeed(
  form: ExportForm,
  context: {
    projectId: string
    pageId: string | null
    pageIsTopic: boolean
    resolved: readonly string[]
    hasTopic: boolean
    /** The one market picked, or null for every market. */
    market: string | null
  }
): Record<string, string> {
  return scheduleSeedParams({
    projectId: context.projectId,
    scope: reportScopeOf(form, context),
    sections: chosenSections(form, context.hasTopic).filter((id) => id !== 'raw'),
    format: reportFormatFor(form.format),
    marketIds: context.market ? [context.market] : []
  })
}
