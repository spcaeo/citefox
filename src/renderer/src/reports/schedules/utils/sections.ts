import { REPORT_SECTIONS, normalizeExportSections, type ReportSectionId } from '@shared/domain'
import type { ExportScopeChoice } from '../../export/model'
import type { ScheduleDraft } from '../../scheduleModel'

/** The stored section ids as Export's on/off map (legacy ids mapped to v2). */
export function sectionMap(sections: readonly string[]): Record<ReportSectionId, boolean> {
  const on = new Set(normalizeExportSections(sections))
  return Object.fromEntries(REPORT_SECTIONS.map((id) => [id, on.has(id)])) as Record<
    ReportSectionId,
    boolean
  >
}

/** The on sections, in report order, as the schedule stores them. */
export function sectionList(map: Readonly<Record<ReportSectionId, boolean>>): string[] {
  return REPORT_SECTIONS.filter((id) => map[id])
}

/** Export's scope word for a schedule's scope, so the same sections are offered. */
export function exportScopeOf(draft: ScheduleDraft): ExportScopeChoice {
  if (draft.projectId === null || draft.scope.kind === 'project') return 'project'
  if (draft.scope.kind === 'pages' && draft.scope.ids.length === 1) return 'page'
  return draft.scope.kind
}
