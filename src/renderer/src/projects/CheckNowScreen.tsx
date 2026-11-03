import { useEffect, useMemo, useState, type JSX } from 'react'
import type { DueList, DuePage, QueueStatus } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { errorText } from '../components/errorText'
import { DrillButton, DrillHost, type ItemDrill } from '../drill'
import { formatStamp } from '../m3/model'
import { sectionHash } from '../shell/routes'
import { CheckNowPanel } from '../checkNow/CheckNowPanel'
import type { CheckNowSource } from '../checkNow/source'
import { Button } from '../ui'
import { checkDueMessage } from './scoreCopy'
import type { ShellClient } from './client'

/**
 * `#/check`: the due queue (`queue:checkDue`, every project) and, under it,
 * the Check now picker for the open project (the same picker as the
 * `check-now` drawer: pages, topics, groups, clusters, markets, questions).
 * A paused project does not disable the queue. A paused queue returns `started: false`.
 */
export function CheckNowScreen({
  client,
  pausedProject,
  projectId = null,
  listDue,
  checkSource
}: {
  client: ShellClient
  pausedProject: boolean
  /** The open project. Due pages in other projects open through a project route. */
  projectId?: string | null
  /** Tests only. Production reads `schedule:listDue` for every project. */
  listDue?: () => Promise<DueList>
  /** Tests only. Production reads the preload bridge. */
  checkSource?: CheckNowSource
}): JSX.Element {
  const readDue = useMemo(() => listDue ?? liveListDue, [listDue])
  const [due, setDue] = useState<DueList | null>(null)
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void readDue().then(
      (list) => {
        if (!cancelled) setDue(list)
      },
      () => {
        if (!cancelled) setDue(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [readDue, attempt, message])

  useEffect(() => {
    let cancelled = false
    void client.getQueueStatus().then(
      (status) => {
        if (cancelled) return
        setQueue(status)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (cancelled) return
        setLoadError(errorText(cause, 'Could not read the queue.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, attempt])

  async function run(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const [result, status] = await Promise.all([client.checkDue(), client.getQueueStatus()])
      setQueue(status)
      setLoadError(null)
      setMessage(checkDueMessage(result, status.state))
    } catch (cause) {
      setMessage(errorText(cause, 'Could not start the check.'))
    } finally {
      setBusy(false)
    }
  }

  const dueDrill = due ? dueItems(due.pages, projectId) : null
  // Nothing to start: the button says so instead of reporting "Check started for 0 pages".
  const nothingDue = queue !== null && queue.pagesDue === 0
  const duePages = due?.pages ?? []
  useAiContext({
    entities: duePages.map((page) => ({
      kind: 'page' as const,
      id: page.pageId,
      label: page.label ?? page.title ?? page.url ?? page.pageId,
      detail: REASON[page.reason]
    })),
    numbers: queue
      ? [
          { label: 'Pages due', value: String(queue.pagesDue) },
          { label: 'Checks running', value: String(queue.running) },
          { label: 'Checks waiting', value: String(queue.waiting) }
        ]
      : [],
    facts: [
      ...(pausedProject ? ['This project is paused; Check now still runs it.'] : []),
      ...(queue && queue.state !== 'running' ? ['Checks are paused.'] : []),
      ...(message ? [message] : [])
    ]
  })

  return (
    <DrillHost>
      <section className="cn" aria-label="Check now">
        <p className="cn-help">
          {pausedProject
            ? 'This project is paused. Check now still runs.'
            : 'Check the pages that are due in every project, or choose what to check below and press Check now. A paused project is left for after resume.'}
        </p>
        <div className="cn-row">
          <Button
            variant="secondary"
            busy={busy}
            disabled={nothingDue}
            aria-describedby={nothingDue ? 'cn-nothing-due' : undefined}
            onClick={() => void run()}
          >
            Check due pages now
          </Button>
          {queue ? (
            <span className="cn-meta">
              {pluralize(queue.pagesDue, 'page')} due
              {queue.state === 'running' ? '' : ' · checks are paused'}
              {dueDrill && dueDrill.items.length > 0 ? (
                <>
                  {' · '}
                  <DrillButton
                    drill={dueDrill}
                    label={`Show the due pages (${dueDrill.items.length}): the ${pluralize(dueDrill.items.length, 'page')} on today's due list`}
                  >
                    Show the due pages (
                    <span data-nfr-figure={dueDrill.id}>{dueDrill.items.length}</span>)
                  </DrillButton>
                </>
              ) : null}
            </span>
          ) : loadError ? null : (
            <span className="cn-meta">Loading the queue…</span>
          )}
        </div>
        {nothingDue ? (
          <p className="cn-message" id="cn-nothing-due">
            Nothing is due right now, so this button has nothing to check.{' '}
            {projectId
              ? 'To check anyway, choose “Everything again” below and press Check now. Or '
              : ''}
            <a href={sectionHash('pages')}>Choose pages in All pages</a> and use Check now on any
            page you want checked now.
          </p>
        ) : null}
        {message ? (
          <p className="cn-message">
            <span role="status">{message}</span>{' '}
            <a href={sectionHash('status')}>See running and waiting checks in Status</a>
          </p>
        ) : null}
        {!queue && loadError ? (
          <LoadError
            title="CiteFox could not read the check queue."
            message={loadError}
            onRetry={() => {
              setLoadError(null)
              setAttempt((current) => current + 1)
            }}
          />
        ) : null}
      </section>
      {projectId ? (
        <CheckNowPanel projectId={projectId} {...(checkSource ? { source: checkSource } : {})} />
      ) : null}
    </DrillHost>
  )
}

const REASON: Record<DuePage['reason'], string> = {
  scheduled: 'Scheduled',
  follow_up: 'Fix follow-up',
  catch_up: 'Catch-up'
}

/** Today's due list as a drawer: each page opens its Results, in its own project. */
function dueItems(pages: readonly DuePage[], projectId: string | null): ItemDrill {
  return {
    kind: 'items',
    id: 'due:today',
    title: 'Pages due today',
    description: "The pages on today's due list, in every project. Check now checks them.",
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'reason', label: 'Why', width: '120px' },
      { id: 'due', label: 'Due', width: '150px' }
    ],
    items: pages.map((page) => ({
      id: `${page.projectId}:${page.pageId}:${page.reason}`,
      primary: page.label ?? page.title ?? page.url ?? page.pageId,
      secondary: page.url,
      target: {
        kind: 'page',
        pageId: page.pageId,
        tab: 'results',
        projectId: page.projectId === projectId ? null : page.projectId
      },
      cells: { reason: REASON[page.reason], due: formatStamp(page.dueAt) }
    })),
    note: 'Select a page to open its Results. A page in another project switches to that project first.',
    scope: {
      pageId: null,
      marketId: null,
      runId: null,
      marketLabel: '',
      checkDateLabel: '',
      brand: '',
      domain: ''
    }
  }
}

function liveListDue(): Promise<DueList> {
  if (typeof window === 'undefined' || !window.citefox) {
    return Promise.reject(new Error('The preload bridge is missing.'))
  }
  return window.citefox['schedule:listDue']({ projectId: null })
}
