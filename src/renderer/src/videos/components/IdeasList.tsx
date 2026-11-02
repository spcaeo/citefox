import type { JSX } from 'react'
import type { Market, VideoIdea, VideoStep } from '@shared/domain'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { DrillButton, DrillNumber } from '../../drill'
import {
  Button,
  Chip,
  EmptyState,
  ListGrid,
  UrlText,
  type FilterGroup,
  type ListColumn
} from '../../ui'
import { evidenceDrill, type VideoDrills } from '../utils/drill'
import { formatDate, marketName, STEP_COLUMNS, stepLabel } from '../utils/model'
import { PageLink, PromptLinks } from './Links'

function ideaTitle(idea: VideoIdea): string {
  return idea.brief?.title ?? idea.question
}

const STEP_TONE: Readonly<Record<VideoStep, 'neutral' | 'info' | 'warn' | 'ok'>> = {
  idea: 'neutral',
  brief: 'info',
  sent: 'warn',
  published: 'ok',
  tracking: 'ok'
}

/**
 * FR-18.2: one row per idea, ranked by evidence. The step filter replaces the
 * old board; selecting a row (or its status) opens the idea's flow in a side panel.
 */
export function IdeasGrid({
  ideas,
  markets,
  step,
  onStep,
  selectedId,
  onSelect,
  drills,
  filterControls
}: {
  ideas: readonly VideoIdea[]
  markets: readonly Market[]
  step: VideoStep | 'all'
  onStep: (step: VideoStep | 'all') => void
  /** The idea open in the side panel. */
  selectedId: string | null
  onSelect: (id: string) => void
  drills: VideoDrills
  /** The screen's market and scope filters. */
  filterControls?: readonly FilterGroup[]
}): JSX.Element {
  const rows = step === 'all' ? ideas : ideas.filter((idea) => idea.step === step)

  const columns: ListColumn<VideoIdea>[] = [
    {
      id: 'idea',
      label: 'Video idea',
      width: 'fill',
      minWidth: 180,
      sort: (idea) => ideaTitle(idea).toLowerCase(),
      render: (idea) => (
        <span className="yt-idea-cell">
          <button
            type="button"
            className="yt-row-link"
            aria-pressed={idea.id === selectedId}
            onClick={() => onSelect(idea.id)}
          >
            {ideaTitle(idea)}
          </button>
          {idea.brief ? <span className="yt-muted yt-clip">Answers: “{idea.question}”</span> : null}
        </span>
      )
    },
    {
      id: 'page',
      label: 'Based on',
      width: 150,
      render: (idea) => (
        <span className="yt-stack">
          <span className="yt-clip">
            <PageLink idea={idea} />
          </span>
          <PromptLinks idea={idea} className="yt-muted yt-clip" />
        </span>
      )
    },
    {
      id: 'evidence',
      label: 'Evidence',
      width: 96,
      numeric: true,
      sort: (idea) => idea.evidence,
      render: (idea) => (
        <span className="yt-evidence">
          <DrillNumber
            drill={drills.of(evidenceDrill(idea))}
            label={`${idea.evidence} ${idea.evidence === 1 ? 'question shows' : 'questions show'} a video. Show them`}
          />
          <span className="yt-muted">{idea.evidence === 1 ? 'question' : 'questions'}</span>
        </span>
      )
    },
    {
      id: 'markets',
      label: 'Markets',
      width: 144,
      render: (idea) => <MarketTags idea={idea} markets={markets} drills={drills} />
    },
    {
      id: 'videos',
      label: 'Videos cited now',
      width: 142,
      render: (idea) => <VideoList idea={idea} />
    },
    {
      id: 'status',
      label: 'Status',
      width: 120,
      sort: (idea) => STEP_COLUMNS.findIndex((column) => column.step === idea.step),
      render: (idea) => (
        <span className="yt-status-cell">
          <StatusButton idea={idea} selected={idea.id === selectedId} onSelect={onSelect} />
          {idea.deadline ? (
            <span className="yt-muted yt-deadline">Due {formatDate(idea.deadline)}</span>
          ) : null}
        </span>
      )
    },
    askColumn(
      (idea) => ({
        kind: 'video',
        id: idea.id,
        label: ideaTitle(idea),
        detail: stepLabel(idea.step)
      }),
      (idea) => [
        `Why do AI Overviews cite a video for “${idea.question}”?`,
        `Draft a video brief for “${idea.question}”`,
        'Which video idea should I make first?'
      ]
    )
  ]

  return (
    <ListGrid
      label="Video opportunities"
      noun={['idea', 'ideas']}
      rows={rows}
      rowKey={(idea) => idea.id}
      rowLabel={ideaTitle}
      columns={columns}
      search={{
        text: (idea) => `${ideaTitle(idea)} ${idea.question} ${idea.pageLabel}`,
        placeholder: 'Search ideas'
      }}
      filter={{
        label: 'Step',
        options: [
          { value: 'all', label: 'All', count: ideas.length },
          ...STEP_COLUMNS.map((column) => ({
            value: column.step,
            label: column.label,
            count: ideas.filter((idea) => idea.step === column.step).length
          }))
        ],
        value: step,
        onChange: (value) => onStep(value as VideoStep | 'all')
      }}
      filterControls={filterControls}
      onActivate={(idea) => onSelect(idea.id)}
      isRowCurrent={(idea) => idea.id === selectedId}
      summary={(info) =>
        `${info.matching} of ${ideas.length} ${ideas.length === 1 ? 'idea' : 'ideas'} · ranked by evidence: tracked questions whose overview cites a video for the same question`
      }
      empty={
        ideas.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No video opportunities here"
            body="No overview in this scope cites a video that isn't yours."
          />
        ) : (
          <EmptyState
            title={`Nothing at ${step === 'all' ? 'this step' : stepLabel(step)}`}
            action={
              <Button size="sm" onClick={() => onStep('all')}>
                Show all ideas
              </Button>
            }
          />
        )
      }
    />
  )
}

/** The idea's step. Selecting it opens the idea's flow, like the title. */
function StatusButton({
  idea,
  selected,
  onSelect
}: {
  idea: VideoIdea
  selected: boolean
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="yt-status-btn"
      aria-pressed={selected}
      aria-label={`${stepLabel(idea.step)}: open the flow for ${idea.brief?.title ?? idea.question}`}
      onClick={() => onSelect(idea.id)}
    >
      <Chip size="sm" tone={STEP_TONE[idea.step]} dot>
        {stepLabel(idea.step)}
      </Chip>
    </button>
  )
}

/** Each market opens the idea's evidence in that market. */
function MarketTags({
  idea,
  markets,
  drills
}: {
  idea: VideoIdea
  markets: readonly Market[]
  drills: VideoDrills
}): JSX.Element {
  if (idea.marketIds.length === 0) return <span className="yt-muted">—</span>
  return (
    <span className="yt-tags">
      {idea.marketIds.map((id) => {
        const name = marketName(markets, id)
        const drill = drills.of({
          id: `evidence-${idea.id}-${id}`,
          title: `Overviews showing a video · ${name}`,
          description: `Latest overviews in ${name} for this idea's questions that cite a YouTube video.`,
          keys: drills.inMarket(idea.evidenceKeys, id)
        })
        return (
          <DrillButton
            key={id}
            drill={drill}
            className="yt-tag-btn"
            label={`${name}: ${drill.items.length} overviews show a video. Show them`}
            untracked
          >
            {name}
          </DrillButton>
        )
      })}
    </span>
  )
}

function VideoList({ idea }: { idea: VideoIdea }): JSX.Element {
  const first = idea.videos[0]
  if (!first) return <span className="yt-muted">None</span>
  return (
    <span className="yt-stack">
      <UrlText url={first.url} label={first.title ?? first.url} plain />
      <span className="yt-muted yt-clip">
        {first.channelTitle ?? 'Channel unknown'}
        {first.yours ? ' · Yours' : ''}
        {idea.videos.length > 1 ? ` · +${idea.videos.length - 1} more` : ''}
      </span>
    </span>
  )
}
