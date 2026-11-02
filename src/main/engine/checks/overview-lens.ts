import type { OverviewLens } from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import { readProjectProfile } from '../../storage/project-profile'
import { competitorContext } from '../competitor-context'

/**
 * What the prompt page reads one overview against: the profile's brand names and
 * aliases, the own domain and its subdomains rule, and the competitors of the page's
 * product from `competitorContext()` (never a flat list of its own).
 */
export function overviewLens(db: SqliteDatabase, pageId: string, domain: string): OverviewLens {
  const profile = readProjectProfile(db)
  const context = competitorContext(db, { pageId })
  return {
    brandNames: [...(profile?.brandNames ?? [])],
    ownDomain: domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    productName: context.product?.name ?? null,
    competitors: [
      ...context.direct.map((item) => ({
        name: item.name,
        domain: item.domain,
        tier: 'direct' as const
      })),
      ...context.partial.map((item) => ({
        name: item.name,
        domain: item.domain,
        tier: 'partial' as const
      }))
    ]
  }
}
