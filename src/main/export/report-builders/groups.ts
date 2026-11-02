import { percent } from '@shared/report-copy'
import type { ReportBuildContext, UniverseDimension, UniverseRow } from '../model/types'

/** One site-structure group or cluster and the tracked pages in it (`structure:listMemberships`). */
export interface StructureMembership {
  id: string
  name: string
  kind: 'group' | 'cluster'
  pageIds: readonly string[]
}

/**
 * REPORT-SPEC section 7 "group/cluster when site structure exists": one universe row
 * per group and cluster that holds a page in this report. A page in two groups counts
 * in both rows; every count drills to exactly its rows.
 */
export function structureDimension(
  memberships: readonly StructureMembership[],
  context: ReportBuildContext
): UniverseDimension | null {
  const rows: UniverseRow[] = []
  for (const membership of memberships) {
    const pages = new Set(membership.pageIds)
    const inGroup = context.rows.filter((row) => pages.has(row.pageId))
    if (inGroup.length === 0) continue
    const token = `dim:${membership.kind}=${membership.id}`
    const ids = (keep: (row: (typeof inGroup)[number]) => boolean): string[] =>
      inGroup.filter(keep).map((row) => row.id)
    const aio = context.count(
      `${token}:aio`,
      ids((row) => row.aio)
    )
    const cited = context.count(
      `${token}:cited`,
      ids((row) => row.cited)
    )
    rows.push({
      key: `${membership.kind}:${membership.id}`,
      label: membership.kind === 'cluster' ? `${membership.name} (cluster)` : membership.name,
      prompts: context.count(
        token,
        ids(() => true)
      ),
      aio,
      cited,
      named: context.count(
        `${token}:named`,
        ids((row) => row.named)
      ),
      citedRate: percent(cited.n, aio.n)
    })
  }
  return rows.length === 0 ? null : { id: 'group', title: 'By group and cluster', rows }
}
