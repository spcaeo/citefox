import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { BuyerPrompt, Market, SampleCount } from '@shared/domain'
import type { CheckJob, PageDetail, ProjectDetail } from '@shared/ipc'
import { LoadError } from '../components/LoadError'
import { errorText } from '../components/errorText'
import type { ShellClient } from '../projects/client'
import { isNotFoundError } from '../shell/notFound'
import { NoProject, PageMissing } from '../shell/RouteStates'
import { RunningScreen } from './RunningScreen'
import { withTotals } from './running'
import { takeCheckStart } from './startIntent'
import {
  checkError,
  checkStartMessage,
  createCheckSource,
  jobForPage,
  startCheckRequest,
  type CheckSource
} from './source'

/**
 * First-check progress for one page. The job comes from `checks:listActive`,
 * then `checks:get` on each `checks:progress` for that job.
 */
export function RunningPage({
  client,
  project,
  pageId,
  source
}: {
  client: ShellClient
  project: ProjectDetail | null
  pageId: string
  /** Tests only. Production uses the preload bridge. */
  source?: CheckSource
}): JSX.Element {
  const checks = useMemo(() => source ?? createCheckSource(), [source])
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!project) return
    let cancelled = false
    void client.getPage({ projectId: project.id, pageId }).then(
      (page) => {
        if (!cancelled) setDetail(page)
      },
      (cause: unknown) => {
        if (cancelled) return
        setDetail(null)
        if (isNotFoundError(cause)) setMissing(true)
        else setFailed(errorText(cause, 'Could not load this page.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, project, pageId, attempt])

  if (!project) {
    return <NoProject message="Create a project before checking a page." />
  }
  if (failed) {
    return (
      <LoadError
        title="CiteFox could not load this page's check."
        message={failed}
        onRetry={() => {
          setFailed(null)
          setAttempt((current) => current + 1)
        }}
      />
    )
  }
  if (!detail) {
    return missing ? <PageMissing /> : <p role="status">Loading the check…</p>
  }
  return (
    <RunningJob
      source={checks}
      projectId={project.id}
      pageId={pageId}
      samples={detail.samples}
      markets={detail.markets}
      checkedBefore={detail.score !== null}
    />
  )
}

export function RunningJob({
  source,
  projectId,
  pageId,
  samples,
  markets,
  checkedBefore = false
}: {
  source: CheckSource
  projectId: string
  pageId: string
  samples: SampleCount
  markets: readonly Market[]
  /** `PageSummary.score` is set once a check has finished. */
  checkedBefore?: boolean
}): JSX.Element {
  const [job, setJob] = useState<CheckJob | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [finished, setFinished] = useState(false)
  const [promptCatalog, setPromptCatalog] = useState<readonly BuyerPrompt[]>([])
  const [promptsError, setPromptsError] = useState<string | null>(null)
  const [promptsAttempt, setPromptsAttempt] = useState(0)
  const listed = useRef(0)
  const fetched = useRef(0)
  const startingRef = useRef(false)
  const mounted = useRef(true)
  /** Keep the last `checks:get` snapshot until `checks:start` settles. */
  const preserve = useRef(false)
  /** The latest onStart, for "Start first check" from the review screen. */
  const startRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    startRef.current = onStart
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void source['prompts:list']({ projectId, pageId }).then(
      (view) => {
        if (cancelled) return
        setPromptCatalog(view.prompts)
        setPromptsError(null)
      },
      (cause: unknown) => {
        if (cancelled) return
        setPromptCatalog([])
        setPromptsError(errorText(cause, 'Could not load the questions.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, promptsAttempt])

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      const mine = ++listed.current
      void source['checks:listActive']({ projectId }).then(
        (jobs) => {
          if (cancelled || mine !== listed.current) return
          const running = jobForPage(jobs, pageId)
          if (running) {
            setJob(running)
            setError(null)
            return
          }
          if (preserve.current) return
          setFinished(false)
          setJob(null)
          setError(null)
          // Start first check from the review screen: start it now that none is running.
          if (takeCheckStart(pageId)) void startRef.current?.()
        },
        (cause: unknown) => {
          if (cancelled || mine !== listed.current) return
          if (preserve.current) return
          setFinished(false)
          setJob(null)
          setError(checkError(cause, 'Could not load the check.'))
        }
      )
    }
    const stopProgress = source['checks:progress']((event) => {
      if (event.projectId !== projectId || event.pageId !== pageId) return
      const current = ++fetched.current
      void source['checks:get']({ jobId: event.jobId }).then(
        (next) => {
          if (cancelled || current !== fetched.current) return
          if (
            next &&
            next.pageIds.includes(pageId) &&
            (next.status === 'running' || preserve.current)
          ) {
            setJob(next)
            setError(null)
            return
          }
          if (preserve.current) return
          setJob(null)
          setError(null)
        },
        () => {
          if (!cancelled && current === fetched.current) refresh()
        }
      )
    })
    const stopFinished = source['checks:finished']((event) => {
      if (event.projectId !== projectId || event.pageId !== pageId) return
      if (preserve.current) {
        // Totals after the last push include the brand prompts' searches (FR-16.1).
        void source['checks:get']({ jobId: event.jobId }).then(
          (latest) => {
            if (!cancelled && latest && preserve.current) {
              setJob((shown) => withTotals(shown, latest))
            }
          },
          () => undefined
        )
      }
      refresh()
    })
    refresh()
    return () => {
      cancelled = true
      stopProgress()
      stopFinished()
    }
  }, [source, projectId, pageId])

  async function onStart(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    preserve.current = true
    setStarting(true)
    setFinished(false)
    setError(null)
    try {
      const started = await source['checks:start'](startCheckRequest(projectId, pageId))
      if (!mounted.current) return
      if (
        started.pageIds.includes(pageId) &&
        (started.status === 'finished' || started.status === 'running')
      ) {
        if (started.status === 'finished') setFinished(true)
        // The last progress push comes before the brand prompts' searches (FR-16.1), so
        // take the totals from the job checks:start returns. Steps stay as last shown.
        setJob((shown) => withTotals(shown, started))
        setError(null)
        return
      }
      preserve.current = false
      listed.current += 1
      fetched.current += 1
      setFinished(false)
      setJob(null)
      setError(checkStartMessage(started))
    } catch (cause) {
      if (!mounted.current) return
      preserve.current = false
      listed.current += 1
      fetched.current += 1
      setFinished(false)
      setJob(null)
      setError(checkError(cause, 'Could not start the check.'))
    } finally {
      startingRef.current = false
      if (mounted.current) setStarting(false)
    }
  }

  async function onCancel(): Promise<void> {
    if (!job) return
    try {
      await source['checks:cancel']({ jobId: job.id })
      if (!mounted.current) return
      preserve.current = false
      listed.current += 1
      fetched.current += 1
      setFinished(false)
      setJob(null)
      setError(null)
    } catch (cause) {
      setError(checkError(cause, 'Could not cancel the check.'))
    }
  }

  if (job === undefined && !error && !finished) return <p role="status">Loading the check…</p>
  const shown = job ?? null
  return (
    <>
      {error ? (
        <p id="m3-check-alert" className="bridge-alert" role="alert">
          {error}
        </p>
      ) : null}
      {promptsError ? (
        <LoadError
          title="CiteFox could not load this page's question list. The check still runs, and each question shows once it starts."
          message={promptsError}
          onRetry={() => setPromptsAttempt((current) => current + 1)}
        />
      ) : null}
      <RunningScreen
        pageId={pageId}
        samples={samples}
        markets={markets}
        job={shown}
        onCancel={() => void onCancel()}
        onStart={() => void onStart()}
        starting={starting}
        finished={finished}
        promptCatalog={promptCatalog}
        alertId={error ? 'm3-check-alert' : undefined}
        focusStart={Boolean(error) && shown === null && !finished}
        showSponsor={false}
        checkedBefore={checkedBefore}
      />
    </>
  )
}
