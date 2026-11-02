import type { JSX } from 'react'
import { TOPIC_STAGE_HINT, TOPIC_STAGES, type TopicBand, type TopicStage } from '@shared/domain'
import type { QuestionRow } from '@shared/ipc'
import { DrillNumber, type ItemDrill } from '../../drill'
import { BandChip, NOT_IN_TOPIC, clusterStats } from '../../topics/clusters'
import { IconButton, UiIcon } from '../../ui'
import type { GroupPart } from '../drills'
import { destinationKey, dropDestination } from '../grouping'
import type { GroupMode } from '../model'

/**
 * "cited 3 of 5" (of the questions that showed an AI Overview), or why there is no
 * share yet. A group that also holds keywords leads with the split, so its size
 * reads the same as the Topics screen, which counts questions only. The 3 and the 5
 * open their questions.
 */
function CitedText({
  rows,
  band,
  label,
  drillFor
}: {
  rows: readonly QuestionRow[]
  band?: TopicBand
  label: string
  drillFor: (part: GroupPart) => ItemDrill
}): JSX.Element {
  const stats = clusterStats(rows, band)
  if (stats.questions === 0) return <>keywords only</>
  const keywords = rows.length - stats.questions
  const split =
    keywords > 0 ? `${plural(stats.questions, 'question')} · ${plural(keywords, 'keyword')} · ` : ''
  if (stats.withAio === 0) return <>{split}no AI Overview yet</>
  const cited = drillFor('cited')
  const aio = drillFor('aio')
  return (
    <>
      {split}cited{' '}
      <DrillNumber
        drill={cited}
        label={`cited ${cited.items.length}: the questions in ${label} where you are cited`}
      />{' '}
      of{' '}
      <DrillNumber
        drill={aio}
        label={`of ${aio.items.length}: the questions in ${label} with an AI Overview`}
      />
    </>
  )
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
}

function isStage(key: string): key is TopicStage {
  return (TOPIC_STAGES as readonly string[]).includes(key)
}

/**
 * The line after a group header's count. Every group shows its cited share. A topic
 * adds its band chip and "+ Add to this topic"; "Not in a topic" says where its
 * questions came from and offers Claude's sort; a stage adds its hint. Groups that
 * take a dropped question carry a hidden `data-move-target` the drop zone reads.
 */
export function GroupMeta({
  rows,
  groupKey,
  label,
  mode,
  band,
  addHref,
  onSort,
  drillFor
}: {
  rows: readonly QuestionRow[]
  groupKey: string
  /** The header label, for the controls' names. */
  label: string
  mode: GroupMode
  /** The topic's questions band; the default band otherwise. */
  band: TopicBand | undefined
  /** "+ Add to this topic" for a topic group. */
  addHref: string | null
  onSort: () => void
  /** The questions behind the header's "cited N of M". */
  drillFor: (part: GroupPart) => ItemDrill
}): JSX.Element {
  const drop = dropDestination(mode, groupKey)
  const notInTopic = mode === 'topic' && groupKey === NOT_IN_TOPIC
  return (
    <span className="qs-gmeta">
      {drop ? <span hidden data-move-target={destinationKey(drop)} /> : null}
      {mode === 'stage' && isStage(groupKey) ? (
        <span className="qs-gmeta-text">{TOPIC_STAGE_HINT[groupKey]} ·</span>
      ) : null}
      <span className="qs-gmeta-text num">
        <CitedText rows={rows} band={band} label={label} drillFor={drillFor} />
      </span>
      {mode === 'topic' && !notInTopic ? <BandChip band={clusterStats(rows, band).band} /> : null}
      {notInTopic ? (
        <IconButton icon="sparkle" label="Sort into topics with AI" tip size="sm" onClick={onSort} />
      ) : null}
      {addHref !== null ? (
        <a
          className="ui-icon-btn ui-icon-btn-sm"
          href={addHref}
          aria-label={`Add questions to ${label}`}
          data-tip={`Add questions to ${label}`}
        >
          <UiIcon name="plus" size={16} />
        </a>
      ) : null}
    </span>
  )
}
