import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { PageResults } from '@shared/domain'
import type { AssistClient } from '../assist/client'
import type { PageChrome } from '../projects/chrome'
import { LoadError } from '../components/LoadError'
import { useEngineRevision } from '../shell/engineRevision'
import { pageHash } from '../shell/routes'
import { formatStamp } from './model'
import { PageResultsScreen } from './PageResultsScreen'
import { checkError, createCheckSource, type CheckSource } from './source'

/**
 * Page results for the open market. `results` is `results:get`.
 * The shell draws the page header, tabs, and sponsor.
 */
export function ResultsPanel({
  source,
  projectId,
  projectName,
  page,
  pageId,
  marketId,
  assistClient,
  runId = null,
  sources
}: {
  /** Tests only. Production uses the preload bridge. */
  source?: CheckSource
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  projectId: string
  projectName: string
  page: PageChrome
  pageId: string
  marketId: string | null
  /** A check pinned by the route (History "View results"). Null is the latest check. */
  runId?: string | null
  /** Drawn at the end of the "Who gets cited" tab (the citations screen). */
  sources?: ReactNode
}): JSX.Element {
  const client = useMemo(() => source ?? createCheckSource(), [source])
  const [results, setResults] = useState<PageResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const requestKey = `${projectId}\0${pageId}\0${marketId ?? ''}\0${runId ?? ''}\0${reload}`
  const revision = useEngineRevision()

  useEffect(() => {
    let cancelled = false
    void client['results:get']({ projectId, pageId, marketId, runId }).then(
      (payload) => {
        if (cancelled) return
        setResults(payload)
        setError(null)
        setLoadedKey(requestKey)
      },
      (cause: unknown) => {
        if (cancelled) return
        setResults(null)
        setError(checkError(cause, 'Could not load results.'))
        setLoadedKey(requestKey)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, marketId, runId, requestKey, revision])

  if (loadedKey !== requestKey || !results) {
    if (loadedKey === requestKey && error) {
      return (
        <LoadError
          title="Could not load results."
          message={error}
          onRetry={() => setReload((n) => n + 1)}
        />
      )
    }
    return <p role="status">Loading results…</p>
  }

  const shownMarketId = marketId ?? page.markets[0]?.id ?? ''
  return (
    <>
      {runId ? (
        <p className="m3-pinned" role="note">
          <span>
            Showing the check from <strong>{formatStamp(results.scope.checkedAt)}</strong>, not the
            latest one.
          </span>{' '}
          <a href={pageHash(pageId, 'results')}>Show the latest check</a>
        </p>
      ) : null}
      <PageResultsScreen
        pageId={pageId}
        projectName={projectName}
        page={page}
        marketId={shownMarketId}
        runId={runId}
        results={results}
        assists={{ projectId, pageId, marketId: shownMarketId, client: assistClient }}
        chrome={false}
        sources={sources}
      />
    </>
  )
}
