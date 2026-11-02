import { useState, type JSX, type ReactNode } from 'react'
import type { ReportTable } from '@shared/ipc'
import {
  sourceSplitChart,
  type Num,
  type ReplyState,
  type ReviewReport,
  type SourceWho
} from '@shared/report/review'
import { Button, ToolButton, UrlText } from '../../../ui'
import { SplitBarChart } from '../../../ui/chart/ReportCharts'
import { Fig } from '../Figures'
import { openReportDrill } from '../drill'
import '../sources.css'

/**
 * Sources ("Who the AI answers lean on"): the citation split, source types, YouTube,
 * Reddit, LinkedIn and the most influential outside pages, for the engine picked. Every
 * count of questions opens exactly those questions; a source type with nothing cited
 * says so in one line.
 */

const REPLY_WORDS: Readonly<Record<ReplyState, string>> = {
  open: 'Yes, open',
  archived: 'No, archived',
  locked: 'No, locked',
  unchecked: 'Not checked'
}

const REPLY_TONE: Readonly<Record<ReplyState, string>> = {
  open: 'up',
  archived: 'down',
  locked: 'down',
  unchecked: 'flat'
}

const WHO_WORDS: Readonly<Record<SourceWho, string>> = {
  you: 'You',
  competitor: 'Competitor',
  other: 'Other site'
}

const FIRST_ROWS = 25

export interface Col<T> {
  head: string
  right?: boolean
  cell: (row: T) => ReactNode
}

/** A plain table with "Show all" past 25 rows. */
export function SimpleTable<T>({
  label,
  rows,
  cols,
  rowKey
}: {
  label: string
  rows: readonly T[]
  cols: readonly Col<T>[]
  rowKey: (row: T) => string
}): JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  return (
    <div className="rv-tbl">
      <table aria-label={label}>
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col.head} className={col.right ? 'rv-r' : undefined}>
                {col.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={rowKey(row)}>
              {cols.map((col) => (
                <td key={col.head} className={col.right ? 'rv-r num' : undefined}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? (
        <div className="rv-more">
          <span className="rv-muted">
            Showing {shown.length} of {rows.length}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
            Show all {rows.length}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Count tiles that each open their questions (zero: plain). */
export function NumTiles({
  tiles
}: {
  tiles: readonly { label: string; num: Num; text?: string }[]
}): JSX.Element {
  return (
    <div className={`rv-tiles rv-tiles-${Math.min(tiles.length, 6)}`}>
      {tiles.map((tile) =>
        tile.num.n === 0 ? (
          <div key={tile.label} className="rv-tile">
            <b className="num">{tile.text ?? 0}</b>
            <small>{tile.label}</small>
          </div>
        ) : (
          <button
            key={tile.label}
            type="button"
            className="rv-tile"
            data-rd={tile.num.drill}
            onClick={() => openReportDrill(tile.num.drill)}
          >
            <b className="num">{tile.text ?? tile.num.n.toLocaleString('en-US')}</b>
            <small>{tile.label}</small>
          </button>
        )
      )}
    </div>
  )
}

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

function Page({ url, title }: { url: string; title: string | null }): JSX.Element {
  return <UrlText url={url} label={title ?? undefined} plain={title !== null} cut="end" />
}

function Panel({
  id,
  title,
  sub,
  csv,
  children
}: {
  id: string
  title: string
  sub?: string
  csv?: (() => void) | null
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby={`rv-src-${id}`}>
      <div className="rv-panel-head">
        <div>
          <h3 id={`rv-src-${id}`}>{title}</h3>
          {sub ? <p className="rv-sub">{sub}</p> : null}
        </div>
        {csv ? <ToolButton kind="csv" onClick={csv} /> : null}
      </div>
      {children}
    </section>
  )
}

export function SourcesSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  const { sources } = report
  if (sources.total === 0) {
    return (
      <p className="rv-note" data-testid="rv-sources-empty">
        No AI answer cites a page in this check yet. Sources fill in once a check finds answers with
        links.
      </p>
    )
  }
  const { youtube, reddit, linkedin, influential } = sources
  return (
    <div className="rv-stack" data-testid="rv-sources">
      <Panel
        id="split"
        title="Who the AI answers lean on"
        sub="These are citations, not questions: one answer can cite many pages."
      >
        <NumTiles
          tiles={[
            { label: 'Answers that cite a source', num: sources.answers },
            { label: 'Cite your pages', num: sources.citingYou },
            { label: 'Cite a competitor', num: sources.citingCompetitor },
            { label: 'Gaps to win: answers without you', num: sources.gaps }
          ]}
        />
        <SplitBarChart {...sourceSplitChart(report)} />
        <p className="rv-muted rv-small">
          {sources.total} citations: {sources.yours} to your pages ({sources.yoursShare}%),{' '}
          {sources.competitor} to competitors, {sources.other} to other sites.{' '}
          {sources.gapCitations} sit in answers that do not cite you.
        </p>
      </Panel>
      <Panel
        id="types"
        title="By source type"
        sub="Web pages, videos, threads and posts the answers cite."
      >
        <SimpleTable
          label="By source type"
          rows={sources.types}
          rowKey={(row) => row.type}
          cols={[
            { head: 'Source type', cell: (row) => <b>{row.label}</b> },
            { head: 'Pages', right: true, cell: (row) => count(row.pages) },
            { head: 'Citations', right: true, cell: (row) => count(row.citations) },
            { head: 'Share', right: true, cell: (row) => `${row.share}%` },
            { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> }
          ]}
        />
      </Panel>
      <Panel
        id="youtube"
        title="YouTube"
        sub="Videos the answers cite. Gap: questions where the video is cited and you are not."
        csv={youtube.videos.length > 0 ? () => onCsv('youtube') : null}
      >
        {youtube.videos.length === 0 ? (
          <p className="rv-muted">No YouTube videos are cited in these answers.</p>
        ) : (
          <>
            {youtube.channels.length > 0 ? (
              <SimpleTable
                label="By channel"
                rows={youtube.channels}
                rowKey={(row) => row.channel}
                cols={[
                  { head: 'Channel', cell: (row) => <b>{row.channel}</b> },
                  { head: 'Videos', right: true, cell: (row) => count(row.videos) },
                  { head: 'Citations', right: true, cell: (row) => count(row.citations) },
                  { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> }
                ]}
              />
            ) : null}
            <SimpleTable
              label="Videos"
              rows={youtube.videos}
              rowKey={(row) => row.videoId}
              cols={[
                { head: 'Video', cell: (row) => <Page url={row.url} title={row.title} /> },
                { head: 'Channel', cell: (row) => row.channel ?? '—' },
                { head: 'Views', right: true, cell: (row) => count(row.views) },
                { head: 'Citations', right: true, cell: (row) => count(row.citations) },
                { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> },
                { head: 'Gap', right: true, cell: (row) => <Fig num={row.gap} /> },
                { head: 'Posted', cell: (row) => row.posted ?? '—' }
              ]}
            />
            {youtube.detailsMissing ? (
              <p className="rv-muted rv-small">
                Channel, views and posted dates show after Communities → Get views and dates.
              </p>
            ) : null}
          </>
        )}
      </Panel>
      <Panel
        id="reddit"
        title="Reddit"
        sub="Threads the answers cite. Reply where you still can, with real help, not ads."
        csv={reddit.threads.length > 0 ? () => onCsv('reddit') : null}
      >
        {reddit.threads.length === 0 ? (
          <p className="rv-muted">{reddit.sentence}</p>
        ) : (
          <>
            <p className="rv-p">{reddit.sentence}</p>
            <SimpleTable
              label="By subreddit"
              rows={reddit.subreddits}
              rowKey={(row) => row.name}
              cols={[
                { head: 'Subreddit', cell: (row) => <b>{row.name}</b> },
                { head: 'Threads', right: true, cell: (row) => count(row.threads) },
                { head: 'Citations', right: true, cell: (row) => count(row.citations) },
                { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> }
              ]}
            />
            <SimpleTable
              label="Threads"
              rows={reddit.threads}
              rowKey={(row) => row.url}
              cols={[
                {
                  head: 'Can we reply?',
                  cell: (row) => (
                    <span className={`rv-pill rv-pill-${REPLY_TONE[row.reply]}`}>
                      {REPLY_WORDS[row.reply]}
                    </span>
                  )
                },
                { head: 'Upvotes', right: true, cell: (row) => count(row.upvotes) },
                { head: 'Thread', cell: (row) => <Page url={row.url} title={row.title} /> },
                { head: 'Subreddit', cell: (row) => row.subreddit },
                { head: 'Comments', right: true, cell: (row) => count(row.comments) },
                { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> },
                { head: 'Gap', right: true, cell: (row) => <Fig num={row.gap} /> }
              ]}
            />
          </>
        )}
      </Panel>
      <Panel
        id="linkedin"
        title="LinkedIn"
        csv={linkedin.length > 0 ? () => onCsv('linkedin') : null}
      >
        {linkedin.length === 0 ? (
          <p className="rv-muted">No LinkedIn pages are cited in these answers.</p>
        ) : (
          <SimpleTable
            label="LinkedIn pages"
            rows={linkedin}
            rowKey={(row) => row.url}
            cols={[
              { head: 'Page', cell: (row) => <Page url={row.url} title={row.title} /> },
              { head: 'Kind', cell: (row) => KIND_WORDS[row.kind] },
              { head: 'Citations', right: true, cell: (row) => count(row.citations) },
              { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> }
            ]}
          />
        )}
      </Panel>
      <Panel
        id="influential"
        title="Most influential outside pages"
        sub="Pages cited on the most questions. Gap: questions they win and you do not."
      >
        {influential.length === 0 ? (
          <p className="rv-muted">Only your own pages are cited.</p>
        ) : (
          <SimpleTable
            label="Most influential outside pages"
            rows={influential}
            rowKey={(row) => row.url}
            cols={[
              { head: 'Page', cell: (row) => <Page url={row.url} title={row.title} /> },
              { head: 'Whose', cell: (row) => WHO_WORDS[row.who] },
              { head: 'Questions', right: true, cell: (row) => <Fig num={row.questions} /> },
              { head: 'Citations', right: true, cell: (row) => count(row.citations) },
              { head: 'Gap', right: true, cell: (row) => <Fig num={row.gap} /> }
            ]}
          />
        )}
      </Panel>
    </div>
  )
}

const KIND_WORDS = { post: 'Post', article: 'Article', profile: 'Profile', other: 'Page' } as const
