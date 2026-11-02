import type { ReportScheduleListItem } from '@shared/domain'
import { describeScope, type ScopeOptions } from '../../../scope'

/** "Whole project", "Money pages (group)", "12 pages". */
export function scopeLine(item: ReportScheduleListItem, options: ScopeOptions | null): string {
  if (item.projectId === null) return 'Every project, one email each'
  const scope = item.scope
  if (!scope || scope.kind === 'project') return 'Whole project'
  const text = describeScope({ kind: scope.kind, ids: scope.ids }, options)
  if (scope.kind === 'group' || scope.kind === 'cluster' || scope.kind === 'topic') {
    return `${text} (${scope.kind})`
  }
  return text
}
