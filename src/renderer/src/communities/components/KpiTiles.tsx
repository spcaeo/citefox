import type { JSX } from 'react'
import {
  OPPORTUNITY_SOURCE_TYPES,
  type CommunitiesReport,
  type SourceMixCheck
} from '@shared/domain'
import { DrillNumber } from '../../drill'
import { KpiStrip, KpiTile, UrlText } from '../../ui'
import type { CommunityDrills } from '../drills'
import { dateRange, plural } from '../utils/model'

const COMMUNITY_TYPES = new Set<string>([...OPPORTUNITY_SOURCE_TYPES, 'review', 'forum'])

/**
 * The four KPI tiles over the sections. Each number opens exactly what it
 * counts in the shared drawer (NFR-14). "Not your page" means the page the
 * prompt is tracked for, so in project scope the copy says "its page".
 */
export function KpiTiles({
  report,
  newest,
  drills,
  scopeLabel
}: {
  report: CommunitiesReport
  newest: SourceMixCheck
  drills: CommunityDrills
  scopeLabel: string
}): JSX.Element {
  const project = report.scope === 'project'
  const community = report.links.filter(
    (link) => link.checkIndex === newest.index && COMMUNITY_TYPES.has(link.type)
  )
  const yours = newest.owners.find((owner) => owner.owner === 'yours')
  return (
    <KpiStrip className="cm-kpis" label="Communities summary">
      <KpiTile
        label="Answers"
        value={
          <DrillNumber
            drill={drills.answers(
              {
                id: 'mix:aios',
                title: 'Answers in the newest check',
                description: `Every AI Overview counted in the source mix · ${scopeLabel}.`
              },
              newest.aioKeys
            )}
            label={`${plural(newest.aios, 'answer')} in the newest check`}
          />
        }
        sub={`newest check · ${dateRange(newest)}`}
      />
      <KpiTile
        label="Community citations"
        value={
          <DrillNumber
            drill={drills.links(
              {
                id: 'links:community',
                title: 'Community citations',
                description: `Reddit, YouTube, LinkedIn, review-site and forum links in the newest check · ${scopeLabel}. One row per link per answer.`
              },
              community,
              'type'
            )}
            label={`${plural(community.length, 'community citation')} in the newest check`}
          />
        }
        suffix={`of ${newest.citations}`}
        sub="forums, videos and reviews"
      />
      <KpiTile
        label="Answers citing your site"
        value={
          <DrillNumber
            drill={drills.answers(
              {
                id: 'kpi:yours',
                title: `Answers citing ${report.domain}`,
                description: `Answers in the newest check that cite a ${report.domain} page.`
              },
              yours?.aioKeys ?? []
            )}
            label={`${plural(yours?.aios ?? 0, 'answer')} cite ${report.domain}`}
          />
        }
        suffix={`/ ${newest.aios}`}
        sub={<UrlText url={`https://${report.domain}`} label={report.domain} plain />}
      />
      <KpiTile
        label="Opportunities"
        value={
          <DrillNumber
            drill={drills.answers(
              {
                id: 'opportunities',
                title: 'Opportunities',
                description: project
                  ? 'Answers in the newest check that cite Reddit, YouTube or LinkedIn but not the page their question is tracked for.'
                  : 'Answers in the newest check that cite Reddit, YouTube or LinkedIn but not this page.'
              },
              report.opportunities.map((row) => row.aioKey)
            )}
            label={`${plural(report.opportunities.length, 'answer')}: opportunities`}
          />
        }
        sub={project ? 'a community, not its page' : 'a community, not your page'}
      />
    </KpiStrip>
  )
}
