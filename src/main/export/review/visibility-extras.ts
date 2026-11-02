import type { MetricsResult } from '@shared/metrics'
import { engineRowsOf, type SinceData, type VisibilityExtras } from '@shared/report/review'
import { loadMetrics } from '../../metrics/assemble'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import type { ProjectRecord } from '../../storage/records'
import { questionTargetPages } from '../../topics/question-targets'
import { loadReputationData } from './reputation-extras'

/**
 * The Visibility report's extras (src/shared/report/review/visibility-extras.ts) from the
 * project database: the scope's name and the brands looked for, each question's Primary
 * and Also OK pages (topics/question-targets.ts; a tracked page's own questions point at
 * the page), the tone CiteFox AI read, and what moved since each question's previous
 * check. Read-only: it spends no searches.
 */
export function loadVisibilityExtras(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): VisibilityExtras {
  const profile = readProjectProfile(db)
  const brands = (profile?.brandNames ?? []).map((name) => name.trim()).filter(Boolean)
  return {
    scopeLabel: scopeLabelOf(db, project, metrics),
    brands,
    targets: targetsOf(db, project, metrics),
    reputation: loadReputationData(
      db,
      project.id,
      metrics,
      brands[0] ?? null,
      (profile?.competitors ?? []).map((name) => name.trim()).filter(Boolean)
    ),
    since: loadSince(db, project, metrics)
  }
}

function scopeLabelOf(db: SqliteDatabase, project: ProjectRecord, metrics: MetricsResult): string {
  const scope = metrics.scope
  if (scope.kind === 'project') return 'Whole project'
  const page = listPages(db, project.id).find((item) => item.id === scope.id)
  const name = page?.label ?? page?.title ?? page?.url ?? scope.id
  return `${scope.kind === 'topic' ? 'Topic' : 'Page'}: ${name}`
}

/** Each question's right pages, by question id: Primary first, then Also OK. */
export function targetsOf(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): Record<string, readonly string[]> {
  const pages = new Map(listPages(db, project.id).map((page) => [page.id, page]))
  const topicPages = new Map<string, Map<string, readonly string[]>>()
  const out: Record<string, readonly string[]> = {}
  for (const id of metrics.now.checked.ids) {
    for (const row of engineRowsOf(metrics, id)) {
      if (out[row.questionId] !== undefined) continue
      if (row.sourceKind === 'page') {
        const url = pages.get(row.sourceId)?.url ?? null
        out[row.questionId] = url === null ? [] : [url]
        continue
      }
      let byPrompt = topicPages.get(row.sourceId)
      if (byPrompt === undefined) {
        byPrompt = questionTargetPages(db, row.sourceId)
        topicPages.set(row.sourceId, byPrompt)
      }
      const promptId = row.id.split(':').slice(2).join(':')
      out[row.questionId] = byPrompt.get(promptId) ?? []
    }
  }
  return out
}

/**
 * What moved since each question's previous check, when the report reads one check
 * (the Visibility report): the same request compared with `previous`. Null with a single
 * check or when the report already compares two checks.
 */
export function loadSince(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): SinceData | null {
  if (metrics.window.from !== null || metrics.checks.length < 2) return null
  const compared = loadMetrics(db, project, {
    projectId: project.id,
    scope: metrics.scope,
    marketId: metrics.marketId,
    engine: metrics.engine,
    from: 'previous',
    to: metrics.window.to
  })
  const comparison = compared.comparison
  if (comparison === null || comparison.compared.n === 0) return null
  let fromAt = ''
  for (const fromId of Object.values(compared.fromOf)) {
    const at = compared.rows[fromId]?.checkedAt ?? ''
    if (at > fromAt) fromAt = at
  }
  if (fromAt === '') return null
  const m = comparison.movement
  const before = new Set(m.namedBefore.ids)
  const after = new Set(m.namedAfter.ids)
  return {
    fromAt,
    gained: m.gained.ids,
    lost: m.lost.ids,
    newlyNamed: m.namedAfter.ids.filter((id) => !before.has(id)),
    noLongerNamed: m.namedBefore.ids.filter((id) => !after.has(id))
  }
}
