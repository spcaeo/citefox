import type { JSX, ReactNode } from 'react'
import type { VideoStats } from '@shared/domain'
import { DrillButton, DrillFigure, type ItemDrill } from '../../drill'
import { KpiStrip, KpiTile } from '../../ui'
import type { AioDrill } from '../types'
import { VIDEO_SCOPE, type VideoDrills } from '../utils/drill'
import { kpiPercent } from '../utils/model'

/**
 * FR-18.1, four tiles. Each count opens exactly the answers (or channels)
 * behind it (NFR-14); "Overviews shown" is the base on the first tile's sub line.
 */
export function KpiTiles({
  stats,
  drills
}: {
  stats: VideoStats
  drills: VideoDrills
}): JSX.Element {
  const shown = drills.of({
    id: 'yt:shown',
    title: 'Overviews shown',
    description: 'Questions whose latest check showed a Google AI Overview.',
    keys: stats.aiosShownKeys
  })
  return (
    <KpiStrip className="yt-stats" label="Video numbers">
      <Tile
        label="Cite at least one YouTube video"
        note={
          <>
            {kpiPercent(stats.citingVideo, stats.aiosShown)} of{' '}
            <DrillButton
              drill={shown}
              className="yt-link"
              label={`${shown.items.length} overviews shown. Show the answers`}
            >
              <DrillFigure drill={shown} /> overviews shown
            </DrillButton>{' '}
            · {stats.prompts} {stats.prompts === 1 ? 'question' : 'questions'}
          </>
        }
        drill={drills.of({
          id: 'yt:video',
          title: 'Cite a YouTube video',
          description: 'Overviews that cite at least one YouTube video.',
          keys: stats.citingVideoKeys
        })}
      />
      <Tile
        label="Cite your video"
        note={
          stats.citingYours > 0
            ? 'Overviews citing a video of yours'
            : 'No overview cites your video yet'
        }
        drill={drills.of({
          id: 'yt:yours',
          title: 'Cite your video',
          description: 'Overviews that cite a video on your channel or one you track here.',
          keys: stats.citingYoursKeys
        })}
      />
      <Tile
        label="Open video slots"
        note="Overviews citing a video that isn't yours"
        drill={drills.of({
          id: 'yt:open',
          title: 'Open video slots',
          description: 'Overviews that cite a video that is not yours.',
          keys: stats.openSlotKeys
        })}
      />
      <CompetitorTile stats={stats} drills={drills} />
    </KpiStrip>
  )
}

function Tile({
  label,
  note,
  drill
}: {
  label: string
  note: ReactNode
  drill: ItemDrill
}): JSX.Element {
  return (
    <KpiTile
      label={label}
      value={
        <DrillButton
          drill={drill}
          className="drill-num yt-num"
          label={`${label}: ${drill.items.length}. Show the answers`}
        >
          <DrillFigure drill={drill} />
        </DrillButton>
      }
      sub={note}
    />
  )
}

/** One answers list per competitor channel, from `competitorChannelKeys`. */
function channelSpecs(stats: VideoStats): { name: string; spec: AioDrill }[] {
  const byName = new Map((stats.competitorChannelKeys ?? []).map((item) => [item.name, item.keys]))
  return stats.competitorChannelNames.map((name) => ({
    name,
    spec: {
      id: `yt:channel:${name}`,
      title: `Cite ${name}`,
      description: `Overviews in this scope that cite a video from the ${name} channel.`,
      keys: byName.get(name) ?? []
    }
  }))
}

function CompetitorTile({
  stats,
  drills
}: {
  stats: VideoStats
  drills: VideoDrills
}): JSX.Element {
  const label = 'Competitor channels cited'
  if (stats.competitorChannels === null) {
    return (
      <KpiTile
        label={label}
        value={<span className="yt-num">—</span>}
        sub={
          <>
            Needs a YouTube Data API key.{' '}
            <a className="yt-link" href="#/connections">
              Add one in Connections
            </a>
          </>
        }
      />
    )
  }
  const perChannel = channelSpecs(stats).map(({ name, spec }) => ({ name, drill: drills.of(spec) }))
  const channels: ItemDrill = {
    kind: 'items',
    id: 'yt:channels',
    title: 'Competitor channels cited',
    description:
      'YouTube channels, not yours, with a video cited in these overviews. Expand a channel to see the questions that cite it.',
    noun: ['channel', 'channels'],
    primaryLabel: 'Channel',
    columns: [{ id: 'answers', label: 'Overviews', align: 'end', width: '96px' }],
    items: perChannel.map(({ name, drill }) => ({
      id: drill.id,
      primary: name,
      cells: { answers: drill.items.length },
      detail: drill.items.map((item) => `- ${item.primary} (${item.secondary ?? ''})`).join('\n')
    })),
    note: 'Select a channel name on the tile to list its overviews with links to Question detail.',
    scope: VIDEO_SCOPE
  }
  return (
    <KpiTile
      label={label}
      value={
        <DrillButton
          drill={channels}
          className="drill-num yt-num"
          label={`${label}: ${channels.items.length}. Show the channels`}
        >
          <DrillFigure drill={channels} />
        </DrillButton>
      }
      sub={
        perChannel.length === 0
          ? 'None in these overviews'
          : perChannel.map(({ name, drill }, index) => (
              <span key={drill.id}>
                {index > 0 ? ', ' : null}
                <DrillButton
                  drill={drill}
                  className="yt-link"
                  label={`${name}: ${drill.items.length} overviews. Show them`}
                >
                  {name} (<DrillFigure drill={drill} />)
                </DrillButton>
              </span>
            ))
      }
    />
  )
}
