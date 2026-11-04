import type { JSX } from 'react'
import type { Market, VideoIdea, VideoTrackingCounts } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillFigure, DrillNumber, type ItemDrill } from '../../drill'
import { EmptyState, ListGrid, UrlText, type FilterGroup, type ListColumn } from '../../ui'
import type { VideoDrills } from '../utils/drill'
import { formatMoment } from '../../utils/dates'
import { marketName, ofAnswers } from '../utils/model'
import { PromptLinks } from './Links'

/**
 * FR-18.7 "Your videos": before and now, side by side. Two facts; the grid
 * never says the video caused a change.
 */
export function YourVideos({
  ideas,
  markets,
  drills,
  filterControls
}: {
  ideas: readonly VideoIdea[]
  markets: readonly Market[]
  drills: VideoDrills
  /** The screen's market and scope filters. */
  filterControls?: readonly FilterGroup[]
}): JSX.Element {
  const tracked = ideas.filter((idea) => idea.videoUrl !== null)
  const columns: ListColumn<VideoIdea>[] = [
    {
      id: 'video',
      label: 'Video',
      width: 'fill',
      minWidth: 160,
      sort: (idea) => (idea.brief?.title ?? idea.question).toLowerCase(),
      render: (idea) => (
        <span className="yt-stack">
          <span className="yt-clip yt-strong">{idea.brief?.title ?? idea.question}</span>
          {idea.videoUrl ? <UrlText url={idea.videoUrl} /> : null}
        </span>
      )
    },
    {
      id: 'prompts',
      label: 'Questions',
      width: 100,
      render: (idea) => <PromptLinks idea={idea} className="yt-clip" />
    },
    {
      id: 'before',
      label: 'Citing it before',
      width: 128,
      render: (idea) =>
        idea.tracking ? <BeforeCell idea={idea} counts={idea.tracking} drills={drills} /> : '—'
    },
    {
      id: 'now',
      label: 'Citing it now',
      width: 128,
      sort: (idea) => idea.tracking?.nowCiting ?? null,
      render: (idea) => {
        const counts = idea.tracking
        if (!counts) return '—'
        return (
          <CountButton
            drill={drills.of({
              id: `yt:now-${idea.id}`,
              title: 'Overviews citing your video',
              description: `Latest overviews for this idea's questions that cite ${idea.videoUrl ?? 'the video'}.`,
              keys: counts.nowKeys
            })}
            whole={counts.nowAios}
          />
        )
      }
    },
    {
      id: 'markets',
      label: 'Markets',
      width: 110,
      render: (idea) => (
        <span className="yt-clip">
          <MarketLinks idea={idea} counts={idea.tracking} markets={markets} drills={drills} />
        </span>
      )
    },
    {
      id: 'checked',
      label: 'Last check',
      width: 130,
      sort: (idea) => idea.tracking?.nowAt ?? null,
      render: (idea) => formatMoment(idea.tracking?.nowAt ?? null)
    },
    {
      id: 'open',
      label: 'Open questions',
      width: 104,
      numeric: true,
      render: (idea) => {
        const counts = idea.tracking
        if (!counts) return '—'
        return (
          <DrillNumber
            drill={drills.of({
              id: `yt:open-${idea.id}`,
              title: 'Not citing your video yet',
              description: "Latest overviews for this idea's questions that do not cite the video.",
              keys: counts.openKeys
            })}
            label={`${counts.openKeys.length} open questions. Show them`}
          />
        )
      }
    }
  ]

  return (
    <div className="page-stack">
      <ListGrid
        label="Your tracked videos"
        noun={['video', 'videos']}
        rows={tracked}
        rowKey={(idea) => idea.id}
        rowLabel={(idea) => idea.brief?.title ?? idea.question}
        columns={columns}
        filterControls={filterControls}
        summary={() => 'Before = the check before you added the video · now = the latest check'}
        empty={
          <EmptyState
            icon="inbox"
            title="No video tracked yet"
            body="Paste a video's URL under Publish and track to add it here."
          />
        }
      />
      <p className="yt-muted yt-small">
        CiteFox shows when an overview starts citing your video. It can&apos;t tell you the video
        caused a change in how your page is cited.
      </p>
    </div>
  )
}

/** "2 of 3 answers" where the first number opens those answers. */
function CountButton({ drill, whole }: { drill: ItemDrill; whole: number }): JSX.Element {
  return (
    <DrillButton
      drill={drill}
      className="drill-num"
      label={`${drill.items.length} of ${pluralize(whole, 'answer')}: ${drill.title}. Show them`}
    >
      <DrillFigure drill={drill} /> of {whole} {whole === 1 ? 'answer' : 'answers'}
    </DrillButton>
  )
}

function BeforeCell({
  idea,
  counts,
  drills
}: {
  idea: VideoIdea
  counts: VideoTrackingCounts
  drills: VideoDrills
}): JSX.Element {
  if (counts.beforeAios === null || counts.beforeKeys === undefined) {
    return <>{ofAnswers(counts.beforeCiting, counts.beforeAios)}</>
  }
  return (
    <CountButton
      drill={drills.of({
        id: `yt:before-${idea.id}`,
        title: 'Overviews citing your video before',
        description: `Overviews at the check before tracking began${counts.beforeAt ? ` (${formatMoment(counts.beforeAt)})` : ''} that cite ${idea.videoUrl ?? 'the video'}.`,
        keys: counts.beforeKeys
      })}
      whole={counts.beforeAios}
    />
  )
}

/** Each market opens the idea's latest answers there. */
function MarketLinks({
  idea,
  counts,
  markets,
  drills
}: {
  idea: VideoIdea
  counts: VideoTrackingCounts | null
  markets: readonly Market[]
  drills: VideoDrills
}): JSX.Element {
  if (idea.marketIds.length === 0) return <>—</>
  if (counts === null) return <>{idea.marketIds.map((id) => marketName(markets, id)).join(', ')}</>
  const latest = [...counts.nowKeys, ...counts.openKeys]
  return (
    <>
      {idea.marketIds.map((id, index) => {
        const name = marketName(markets, id)
        const drill = drills.of({
          id: `yt:market-${idea.id}-${id}`,
          title: `Latest overviews · ${name}`,
          description: `Latest overviews in ${name} for this idea's questions, citing your video or not.`,
          keys: drills.inMarket(latest, id)
        })
        return (
          <span key={id}>
            {index > 0 ? ', ' : null}
            <DrillButton
              drill={drill}
              className="yt-link"
              label={`${name}: ${drill.items.length} latest overviews. Show them`}
              untracked
            >
              {name}
            </DrillButton>
          </span>
        )
      })}
    </>
  )
}
