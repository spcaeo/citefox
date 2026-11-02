import type { JSX, ReactNode } from 'react'
import { askColumn } from '../../assistant/sparkle/askColumn'
import type {
  CommunitiesReport,
  CommunityDiscussion,
  CommunityPost,
  CommunitySourceBase,
  CommunityThread,
  CommunityVideo
} from '@shared/domain'
import {
  DrillButton,
  DrillLink,
  DrillNumber,
  openTarget,
  useDrill,
  type ItemDrill
} from '../../drill'
import { sectionHash } from '../../shell/routes'
import { EmptyState, ListGrid, type ListColumn, type ListGroup, type MenuItem } from '../../ui'
import { formatDay } from '../../utils/dates'
import { mdText } from '../../sentiment/utils/markdown'
import { sourceFacts, threadFacts, type CommunityDrills } from '../drills'
import {
  formatCount,
  formatDuration,
  linkedinKindLabel,
  namedKeys,
  plural,
  replyLabel
} from '../utils/model'
import { replyClosed } from '../utils/reply'
import { baseColumns } from './baseColumns'
import { SourceLink } from './columns'
import { useScopeToolbar } from '../utils/scopeToolbar'
import { EmptyWithFilters } from './ScopeFilters'

/** A source's own drawer: the answers citing it, with what CiteFox knows about it on top. */
function sourceDrill(drills: CommunityDrills, row: CommunitySourceBase, facts: string): ItemDrill {
  return drills.answers(
    {
      id: `source:${row.url}`,
      title: `Answers citing “${row.title ?? row.url.replace(/^https?:\/\//, '')}”`,
      description: facts
    },
    row.aioKeys
  )
}

function videoFacts(video: CommunityVideo): string {
  const parts = [
    video.channelTitle ? `**Channel:** ${mdText(video.channelTitle)}` : null,
    video.views !== null ? `**Views:** ${video.views.toLocaleString('en-US')}` : null,
    video.publishedAt ? `**Published:** ${formatDay(video.publishedAt)}` : null,
    video.durationSeconds !== null ? `**Length:** ${formatDuration(video.durationSeconds)}` : null,
    `**Yours:** ${video.yours ? 'yes' : 'no'}`
  ].filter((part): part is string => part !== null)
  return `${sourceFacts(video, 'video')}\n\n${parts.join(' · ')}`
}

const nameOf = (row: CommunitySourceBase): string => row.title ?? row.url

/** Row actions every source list shares: its answers, and the source in the browser. */
function sourceMenu(row: CommunitySourceBase, onDetail: () => void): MenuItem[] {
  return [
    { id: 'answers', label: 'Show the answers citing it', icon: 'eye', onSelect: onDetail },
    {
      id: 'open',
      label: 'Open in your browser',
      icon: 'external',
      onSelect: () => openTarget({ kind: 'url', url: row.url })
    }
  ]
}

/**
 * One source list: a ListGrid in a test-id wrapper, a row opens the source's
 * drawer. The screen's scope filters sit in its toolbar.
 */
function SourceGrid<T extends CommunitySourceBase>({
  testId,
  label,
  noun,
  rows,
  rowKey,
  columns,
  detail,
  extraMenu,
  actions,
  isRowCurrent,
  group,
  empty
}: {
  testId: string
  label: string
  noun: readonly [string, string]
  rows: readonly T[]
  rowKey: (row: T) => string
  columns: readonly ListColumn<T>[]
  detail: (row: T) => ItemDrill
  extraMenu?: (row: T) => readonly MenuItem[]
  actions?: ReactNode
  isRowCurrent?: (row: T) => boolean
  group?: ListGroup<T>
  empty: string
}): JSX.Element {
  const { open } = useDrill()
  const filters = useScopeToolbar()
  return (
    <div data-testid={testId} className="cm-grid">
      <ListGrid
        label={label}
        noun={noun}
        rows={rows}
        rowKey={rowKey}
        rowLabel={nameOf}
        columns={[...columns, askColumn((row: T) => ({ kind: 'community', label: nameOf(row) }))]}
        search={{
          text: (row) => `${row.title ?? ''} ${row.url}`,
          placeholder: `Search ${rows.length} ${rows.length === 1 ? noun[0] : noun[1]}`
        }}
        {...(filters ? { toolbar: filters } : {})}
        {...(actions ? { actions } : {})}
        rowMenu={(row) => [
          ...(extraMenu?.(row) ?? []),
          ...sourceMenu(row, () => open(detail(row)))
        ]}
        onActivate={(row) => open(detail(row))}
        {...(isRowCurrent ? { isRowCurrent } : {})}
        {...(group ? { group } : {})}
        empty={
          <EmptyWithFilters>
            <EmptyState compact title={empty} />
          </EmptyWithFilters>
        }
      />
    </div>
  )
}

/**
 * FR-17.3, FR-17.4. A row opens the thread's details: status, counts and the
 * prompts citing it. "Draft a helpful reply" (FR-17.6) sits in the row menu
 * and opens one draft under the grid; CiteFox never posts it (FR-17.7).
 */
export function RedditTable({
  report,
  drills,
  drafting,
  onDraft,
  actions
}: {
  report: CommunitiesReport
  drills: CommunityDrills
  /** The thread whose reply draft is open, by URL. */
  drafting: string | null
  onDraft: (row: CommunityThread) => void
  /** Toolbar actions, such as "Check threads". */
  actions?: ReactNode
}): JSX.Element {
  const detail = (row: CommunityThread): ItemDrill =>
    sourceDrill(drills, row, `${sourceFacts(row, 'thread')}\n\n${threadFacts(row)}`)
  const base = baseColumns<CommunityThread>(report, drills, detail)
  const threadLink = (row: CommunityThread, value: number | null, noun: string): JSX.Element =>
    value === null ? (
      <span>—</span>
    ) : (
      <DrillLink
        target={{ kind: 'url', url: row.url }}
        label={`${formatCount(value)} ${noun}: open the thread in your browser`}
      >
        {formatCount(value)}
      </DrillLink>
    )
  const subredditButton = (row: CommunityThread): JSX.Element | null => {
    if (row.subreddit === null) return null
    const threads = report.reddit.filter((thread) => thread.subreddit === row.subreddit)
    const keys = [...new Set(threads.flatMap((thread) => thread.aioKeys))]
    return (
      <DrillButton
        drill={drills.answers(
          {
            id: `subreddit:${row.subreddit}`,
            title: `${row.subreddit}: answers citing its threads`,
            description: `Answers in the newest check that cite any of the ${plural(threads.length, 'thread')} from ${mdText(row.subreddit)}.`
          },
          keys
        )}
        untracked
        label={`${row.subreddit}: show the ${plural(keys.length, 'answer')} citing its threads`}
        className="cm-drill"
      >
        {row.subreddit}
      </DrillButton>
    )
  }
  const columns: ListColumn<CommunityThread>[] = [
    {
      id: 'title',
      label: 'Thread',
      width: 'fill',
      minWidth: 240,
      sort: (row) => row.title ?? row.url,
      render: (row) => (
        <span className="cm-thread">
          {subredditButton(row)}
          <SourceLink url={row.url} title={row.title} />
        </span>
      )
    },
    {
      id: 'reply',
      label: 'Can we reply?',
      width: 112,
      sort: (row) => replyLabel(row.replyState),
      render: (row) => (
        <DrillButton
          drill={detail(row)}
          untracked
          label={`Can we reply to ${nameOf(row)}? ${replyLabel(row.replyState)}. Show the thread's details`}
          className={`cm-reply cm-reply-${row.replyState}`}
        >
          {replyLabel(row.replyState)}
        </DrillButton>
      )
    },
    base.cited,
    base.times,
    base.gap,
    base.first,
    {
      id: 'comments',
      label: 'Comments',
      width: 88,
      numeric: true,
      sort: (row) => row.comments,
      render: (row) => threadLink(row, row.comments, 'comments')
    },
    {
      id: 'brand',
      label: 'Brand?',
      width: 72,
      sort: (row) => (row.brandInThread === null ? null : row.brandInThread ? 1 : 0),
      render: (row) =>
        row.brandInThread === null ? (
          '—'
        ) : (
          <DrillButton
            drill={detail(row)}
            untracked
            label={`Brand in thread: ${row.brandInThread ? 'Yes' : 'No'}. Show the details of ${nameOf(row)}`}
            className="cm-drill"
          >
            {row.brandInThread ? 'Yes' : 'No'}
          </DrillButton>
        )
    }
  ]
  return (
    <SourceGrid
      testId="cm-reddit-table"
      label="Cited Reddit threads"
      noun={['thread', 'threads']}
      rows={report.reddit}
      rowKey={(row) => row.url}
      columns={columns}
      detail={detail}
      {...(actions ? { actions } : {})}
      extraMenu={(row) =>
        replyClosed(row)
          ? []
          : [
              {
                id: 'draft',
                label: drafting === row.url ? 'Show the reply draft' : 'Draft a helpful reply',
                icon: 'sparkle',
                tone: 'ai',
                hint: '10 s',
                onSelect: () => onDraft(row)
              }
            ]
      }
      isRowCurrent={(row) => row.url === drafting}
      empty="No Reddit thread is cited in these overviews"
    />
  )
}

/** FR-17.3. A row opens the answers citing the video; the channel opens all its videos' answers. */
export function YoutubeTable({
  report,
  drills,
  actions
}: {
  report: CommunitiesReport
  drills: CommunityDrills
  actions?: ReactNode
}): JSX.Element {
  const detail = (row: CommunityVideo): ItemDrill => sourceDrill(drills, row, videoFacts(row))
  const base = baseColumns<CommunityVideo>(report, drills, detail)
  const columns: ListColumn<CommunityVideo>[] = [
    {
      id: 'title',
      label: 'Video',
      width: 'fill',
      minWidth: 220,
      sort: (row) => row.title ?? row.url,
      render: (row) => <SourceLink url={row.url} title={row.title} />
    },
    {
      id: 'channel',
      label: 'Channel',
      width: 140,
      sort: (row) => row.channelTitle,
      render: (row) => {
        if (row.channelTitle === null) return '—'
        const videos = report.youtube.filter((video) =>
          row.channelId !== null
            ? video.channelId === row.channelId
            : video.channelTitle === row.channelTitle
        )
        const keys = [...new Set(videos.flatMap((video) => video.aioKeys))]
        return (
          <DrillButton
            drill={drills.answers(
              {
                id: `channel:${row.channelId ?? row.channelTitle}`,
                title: `${row.channelTitle}: answers citing its videos`,
                description: `Answers in the newest check that cite any of the ${plural(videos.length, 'video')} from this channel.`
              },
              keys
            )}
            untracked
            label={`${row.channelTitle}: show the ${plural(keys.length, 'answer')} citing its videos`}
            className="cm-drill"
          >
            {row.channelTitle}
          </DrillButton>
        )
      }
    },
    {
      id: 'views',
      label: 'Views',
      width: 88,
      numeric: true,
      sort: (row) => row.views,
      render: (row) => formatCount(row.views)
    },
    base.cited,
    base.times,
    base.gap,
    {
      id: 'yours',
      label: 'Yours?',
      width: 72,
      sort: (row) => (row.yours ? 1 : 0),
      render: (row) => (
        <DrillLink
          target={{ kind: 'hash', hash: sectionHash('youtube') }}
          label={`${row.yours ? 'Yes' : 'No'}, ${row.yours ? 'yours' : 'not yours'}: open the YouTube screen`}
        >
          {row.yours ? 'Yes' : 'No'}
        </DrillLink>
      )
    }
  ]
  return (
    <SourceGrid
      testId="cm-youtube-table"
      label="Cited YouTube videos"
      noun={['video', 'videos']}
      rows={report.youtube}
      rowKey={(row) => row.videoId}
      columns={columns}
      detail={detail}
      {...(actions ? { actions } : {})}
      empty="No YouTube video is cited in these overviews"
    />
  )
}

export function LinkedinTable({
  report,
  drills
}: {
  report: CommunitiesReport
  drills: CommunityDrills
}): JSX.Element {
  const detail = (row: CommunityPost): ItemDrill =>
    sourceDrill(drills, row, sourceFacts(row, 'LinkedIn page'))
  const base = baseColumns<CommunityPost>(report, drills, detail)
  const columns: ListColumn<CommunityPost>[] = [
    {
      id: 'title',
      label: 'Post or article',
      width: 'fill',
      minWidth: 240,
      sort: (row) => row.title ?? row.url,
      render: (row) => <SourceLink url={row.url} title={row.title} />
    },
    {
      id: 'kind',
      label: 'Kind',
      width: 112,
      sort: (row) => linkedinKindLabel(row.kind),
      render: (row) => linkedinKindLabel(row.kind)
    },
    base.cited,
    base.times,
    base.gap,
    base.first
  ]
  return (
    <SourceGrid
      testId="cm-linkedin-table"
      label="Cited LinkedIn posts and articles"
      noun={['post', 'posts']}
      rows={report.linkedin}
      rowKey={(row) => row.url}
      columns={columns}
      detail={detail}
      empty="No LinkedIn post or article is cited in these overviews"
    />
  )
}

export function ForumsTable({
  report,
  drills
}: {
  report: CommunitiesReport
  drills: CommunityDrills
}): JSX.Element {
  const detail = (row: CommunityDiscussion): ItemDrill =>
    sourceDrill(drills, row, sourceFacts(row, 'discussion'))
  const base = baseColumns<CommunityDiscussion>(report, drills, detail)
  const columns: ListColumn<CommunityDiscussion>[] = [
    {
      id: 'site',
      label: 'Site',
      width: 152,
      cellClassName: 'mono',
      sort: (row) => row.site,
      render: (row) => row.site
    },
    {
      id: 'title',
      label: 'Discussion',
      width: 'fill',
      minWidth: 220,
      sort: (row) => row.title ?? row.url,
      render: (row) => <SourceLink url={row.url} title={row.title} />
    },
    base.cited,
    base.times,
    base.gap,
    {
      id: 'named',
      label: 'Brand named',
      width: 112,
      numeric: true,
      sort: (row) => row.namedInOverview,
      render: (row) =>
        row.namedInOverview > 0 ? (
          <DrillNumber
            drill={drills.answers(
              {
                id: `named:${row.url}`,
                title: 'Brand named with this discussion',
                description: 'Answers that cite this discussion and name your brand in the text.'
              },
              namedKeys(report, row.aioKeys)
            )}
            label={`${row.title ?? row.url}: brand named in ${plural(row.namedInOverview, 'answer')}`}
          />
        ) : (
          <span className="cm-zero">0</span>
        )
    }
  ]
  return (
    <SourceGrid
      testId="cm-forums-table"
      group={{
        key: (row) =>
          row.type === 'review'
            ? { key: 'review', label: 'Review sites' }
            : { key: 'forum', label: 'Other forums' },
        order: ['forum', 'review']
      }}
      label="Cited discussions on other forums and review sites"
      noun={['discussion', 'discussions']}
      rows={report.forums}
      rowKey={(row) => row.url}
      columns={columns}
      detail={detail}
      empty="No other forum or review site is cited in these overviews"
    />
  )
}
