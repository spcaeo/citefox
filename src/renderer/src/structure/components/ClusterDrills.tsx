import type { JSX } from 'react'
import type { ClusterSummary, GroupSummary } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillFigure } from '../../drill'
import { formatScore } from '../../shell/model'
import type { StructureDrills } from '../hooks/useStructureDrills'
import { themeDrill } from '../utils/drills'
import { count } from '../utils/model'
import { AsyncDrill } from './AsyncDrill'

/** A cluster's or group's page count (all or tracked) that opens those pages. */
export function PageCount({
  drills,
  cluster,
  group,
  part
}: {
  drills: StructureDrills
  cluster?: ClusterSummary
  group?: GroupSummary
  part: 'all' | 'tracked'
}): JSX.Element | null {
  const owner = cluster ?? group
  if (!owner) return null
  const value = part === 'all' ? owner.pageCount : owner.trackedCount
  const kind = cluster ? 'cluster' : 'group'
  const nfrId = `${kind}-${part === 'all' ? 'pages' : 'tracked'}:${owner.id}`
  return (
    <AsyncDrill
      nfrId={nfrId}
      label={`${pluralize(value, part === 'all' ? 'page' : 'tracked page')} in ${owner.name}`}
      load={() =>
        cluster
          ? drills.clusterPages(cluster, part)
          : drills.groupPages(group as GroupSummary, part)
      }
    >
      {count(value)}
    </AsyncDrill>
  )
}

/** An average score that opens the page scores behind it. Plain text with no score. */
export function AverageScore({
  drills,
  cluster,
  group
}: {
  drills: StructureDrills
  cluster?: ClusterSummary
  group?: GroupSummary
}): JSX.Element | null {
  const owner = cluster ?? group
  if (!owner) return null
  if (owner.averageScore === null) return <>{formatScore(null)}</>
  return (
    <AsyncDrill
      label={`Average score ${formatScore(owner.averageScore)}: page scores in ${owner.name}`}
      load={() =>
        cluster ? drills.clusterScores(cluster) : drills.groupScores(group as GroupSummary)
      }
    >
      {formatScore(owner.averageScore)}
    </AsyncDrill>
  )
}

/** Theme tags. Each opens the prompts behind it and shows how many there are. */
export function ThemeTags({
  cluster,
  separator
}: {
  cluster: ClusterSummary
  /** Table cells run the themes inline with a separator; cards show tags. */
  separator?: string
}): JSX.Element {
  return (
    <>
      {cluster.themes.map((theme, index) => {
        const drill = themeDrill(cluster, theme)
        const lead = separator && index > 0 ? separator : null
        if (!drill) {
          return (
            <span key={theme}>
              {lead}
              <span className={separator ? '' : 'tag'}>{theme}</span>
            </span>
          )
        }
        return (
          <span key={theme}>
            {lead}
            <DrillButton
              drill={drill}
              className={separator ? 'drill-num str-theme' : 'tag str-theme'}
              // The name starts with the visible text (theme, then count) so voice control finds it.
              label={`${theme} ${pluralize(drill.items.length, 'question')} in ${cluster.name}`}
            >
              {theme} <DrillFigure drill={drill} className="mono str-theme-n" />
            </DrillButton>
          </span>
        )
      })}
    </>
  )
}
