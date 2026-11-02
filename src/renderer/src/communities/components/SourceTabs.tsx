import { useId, useState, type JSX } from 'react'
import type { CommunitiesReport, CommunityThread } from '@shared/domain'
import type { AssistClient } from '../../assist/client'
import { DrillNumber } from '../../drill'
import { sectionHash } from '../../shell/routes'
import { ToolButton } from '../../ui'
import type { CommunityDrills } from '../drills'
import { useSourceActions } from '../hooks/useSourceActions'
import type { CommunitiesSource } from '../source'
import type { AssistSlot, SourceTab } from '../types'
import { replyClosed } from '../utils/reply'
import { ReplyDraft } from './ReplyDraft'
import { ForumsTable, LinkedinTable, RedditTable, YoutubeTable } from './SourceTables'

/**
 * FR-17.3. One list of cited sources: Reddit threads, YouTube videos, LinkedIn
 * posts or other forums. "Check threads" (public Reddit data) and "Get views
 * and dates" (your YouTube key) sit in the grid toolbar; a reply draft opens
 * under the Reddit grid.
 */
export function SourcePanel({
  tab,
  report,
  source,
  pageId,
  assists,
  drills,
  onChanged,
  assistClient
}: {
  tab: SourceTab
  report: CommunitiesReport
  source: CommunitiesSource
  /** For the assist slot. Null on the project screen with every page in scope. */
  pageId: string | null
  assists?: AssistSlot
  drills: CommunityDrills
  onChanged: () => void
  /** The reply-draft assist client. Defaults to the app's (tests pass a fake). */
  assistClient?: AssistClient
}): JSX.Element {
  const actions = useSourceActions(source, report.projectId, onChanged)
  const [drafting, setDrafting] = useState<string | null>(null)
  const draftId = useId()
  const thread: CommunityThread | null =
    report.reddit.find((row) => row.url === drafting && !replyClosed(row)) ?? null
  const status = tab === 'reddit' ? actions.threadsMessage : actions.videosMessage

  return (
    <div className="cm-stack-panel">
      {tab === 'reddit' ? (
        <>
          <p className="cm-note">CiteFox never posts. You copy and post each reply.</p>
          <RedditTable
            report={report}
            drills={drills}
            drafting={thread?.url ?? null}
            onDraft={(row) => setDrafting(row.url)}
            actions={
              <ToolButton
                kind="refresh"
                label="Check threads"
                busy={actions.threadsBusy}
                disabled={report.reddit.length === 0}
                onClick={() => void actions.checkThreads()}
              />
            }
          />
          <p role="status" className="cm-status">
            {status ?? ''}
          </p>
          {thread ? (
            <ReplyDraft
              key={thread.url}
              projectId={report.projectId}
              pageId={report.pageId}
              thread={thread}
              id={draftId}
              onClose={() => setDrafting(null)}
              {...(assistClient ? { client: assistClient } : {})}
            />
          ) : null}
          <ReplyNote report={report} drills={drills} />
        </>
      ) : null}
      {tab === 'youtube' ? (
        <>
          <YoutubeTable
            report={report}
            drills={drills}
            actions={
              <ToolButton
                kind="refresh"
                label="Get views and dates"
                busy={actions.videosBusy}
                disabled={report.youtube.length === 0}
                onClick={() => void actions.refreshVideos()}
              />
            }
          />
          <p role="status" className="cm-status">
            {status ?? ''}
          </p>
          <p className="cm-note">
            Each video is counted once, however it was linked (youtu.be, Shorts, a timestamp).
            {!report.extras.youtubeKey ? (
              <>
                {' '}
                Views and publish dates need your own YouTube Data API key.{' '}
                <a href={sectionHash('connections')}>Add it in Connections</a>.
              </>
            ) : null}
          </p>
        </>
      ) : null}
      {tab === 'linkedin' ? <LinkedinTable report={report} drills={drills} /> : null}
      {tab === 'forums' ? <ForumsTable report={report} drills={drills} /> : null}
      {assists?.({ section: tab, report, pageId }) ?? null}
    </div>
  )
}

/** REPORT-SPEC §8: say so when none of the checked threads is open. Both counts list their threads. */
function ReplyNote({
  report,
  drills
}: {
  report: CommunitiesReport
  drills: CommunityDrills
}): JSX.Element | null {
  if (report.reddit.length === 0) return null
  const checked = report.reddit.filter((thread) => thread.replyState !== 'unchecked')
  if (checked.length === 0) {
    return (
      <p className="cm-note">“Can we reply?” stays Unchecked until you select Check threads.</p>
    )
  }
  const open = checked.filter((thread) => thread.replyState === 'open')
  if (open.length === 0) {
    return (
      <p className="cm-note">
        None of the checked threads is open, so there is nothing to reply to here.
      </p>
    )
  }
  return (
    <p className="cm-note">
      <DrillNumber
        drill={drills.threads(
          {
            id: 'threads:open',
            title: 'Threads open for replies',
            description:
              'Cited Reddit threads that are neither archived nor locked, from the last Check threads.'
          },
          open
        )}
        label={`${open.length} open ${open.length === 1 ? 'thread' : 'threads'}, show them`}
      />{' '}
      of{' '}
      <DrillNumber
        drill={drills.threads(
          {
            id: 'threads:checked',
            title: 'Checked threads',
            description: 'Cited Reddit threads CiteFox has read from public Reddit data.'
          },
          checked
        )}
        label={`${checked.length} checked ${checked.length === 1 ? 'thread' : 'threads'}, show them`}
      />{' '}
      checked {checked.length === 1 ? 'thread is' : 'threads are'} open for replies. Answer the
      question first, say who you are, and follow the subreddit&apos;s rules.
    </p>
  )
}
