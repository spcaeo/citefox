import { useCallback, useMemo, useState, type JSX } from 'react'
import { useAiContext } from '../assistant/context/useAiContext'
import { pageLabel } from '../projects/copy'
import { pageScopeRefs } from '../visibility/aiContext'
import type { PageDetail } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import type { ShellClient } from '../projects/client'
import type { TemplatesClient } from '../templates/client'
import { pageGenerationRequest } from '../templates/model'
import { GapsReview } from './gaps/GapsReview'
import {
  FirstCheckBar,
  SetupPanel,
  createPipelineSource,
  usePagePipeline,
  type PipelineSource
} from './pipeline'
import { errorText } from './text'
import './gaps.css'

/**
 * The page's Content gaps tab (owner feedback 5). Until the automatic setup has
 * written the content gaps it shows the live "Setting up this page" panel;
 * then the review: KPI tiles and Matrix · One by one · Page-wide fixes, with the
 * first-check bar on top while the page has never been checked.
 */
export function GapsScreen({
  client,
  templatesClient,
  projectId,
  page,
  marketId,
  focus = null,
  assistClient,
  onChanged,
  pipelineSource
}: {
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  page: PageDetail
  marketId: string
  /** Route focus (`?filter=row:<promptId>` opens that row; `view:one`, `view:fixes`). */
  focus?: string | null
  /** Defaults to the assist client for this window. */
  assistClient?: AssistClient
  /** Setup finished: the shell reloads the page header. */
  onChanged?: () => void
  /** Tests only. Production uses the preload bridge (null: the page's own setup step). */
  pipelineSource?: PipelineSource | null
}): JSX.Element {
  const source = useMemo(
    () => (pipelineSource === undefined ? createPipelineSource() : pipelineSource),
    [pipelineSource]
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const onSettled = useCallback(() => {
    setReloadKey((current) => current + 1)
    onChanged?.()
  }, [onChanged])
  const setup = usePagePipeline(page, { source, onSettled })
  const pipeline = setup.pipeline
  useAiContext({
    entities: pageScopeRefs({
      pageId: page.id,
      page: pageLabel(page),
      market: page.markets.find((item) => item.id === marketId) ?? null
    }),
    ...(focus ? { filters: { focus } } : {})
  })

  if (pipeline === null) {
    return setup.error !== null ? (
      <p className="ps-error" role="alert">
        {setup.error}
      </p>
    ) : (
      <p role="status">Loading setup…</p>
    )
  }

  const coverage = pipeline.steps.find((step) => step.id === 'coverage')
  const settled = pipeline.state === 'ready' || pipeline.state === 'checked'
  if (coverage?.state !== 'done' && !settled) {
    return (
      <SetupPanel
        pipeline={pipeline}
        waitingFor="coverage"
        busy={setup.busy}
        error={setup.error}
        onStart={() => void setup.start()}
        onStop={() => void setup.stop()}
      />
    )
  }

  async function write(): Promise<void> {
    if (source !== null) {
      await setup.start()
      return
    }
    // The in-memory mock has no setup runner: write the matrix directly.
    setWriteError(null)
    setWriting(true)
    try {
      await client.generateGaps(pageGenerationRequest(projectId, page.id, ''))
      setReloadKey((current) => current + 1)
    } catch (cause: unknown) {
      setWriteError(errorText(cause, 'Could not write the content gaps.'))
    } finally {
      setWriting(false)
    }
  }

  const problem = writeError ?? setup.error
  return (
    <GapsReview
      client={client}
      templatesClient={templatesClient}
      projectId={projectId}
      page={page}
      marketId={marketId}
      focus={focus}
      assistClient={assistClient}
      reloadKey={reloadKey}
      writing={writing || setup.busy}
      onWrite={() => void write()}
      header={
        <>
          <FirstCheckBar
            pipeline={pipeline}
            onCheckWhenReady={(on) => void setup.setCheckWhenReady(on)}
          />
          {problem ? (
            <p className="ps-error" role="alert">
              {problem}
            </p>
          ) : null}
        </>
      }
    />
  )
}
