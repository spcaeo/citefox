import type { JSX, ReactNode } from 'react'
import type { PageDetail, PagePipeline, PagePipelineStepId } from '@shared/ipc'
import { stepDone } from './model'
import { SetupPanel } from './SetupPanel'
import type { PipelineSource } from './source'
import { usePagePipeline, type PagePipelineState } from './usePagePipeline'

export interface SetupGateProps {
  page: PageDetail
  /** The step this tab needs before it can show anything. */
  waitingFor: PagePipelineStepId
  /** Runs once when setup settles, so the tab reloads what was just written. */
  onSettled?: () => void
  /** Tests only. Production uses the preload bridge. */
  source?: PipelineSource | null
  children: (state: PagePipelineState & { pipeline: PagePipeline }) => ReactNode
}

/**
 * A page tab that depends on an earlier setup step: the live "Setting up this
 * page" panel until that step is stored, then the tab itself. Never a manual
 * "do this first" instruction (owner feedback 5).
 */
export function SetupGate({
  page,
  waitingFor,
  onSettled,
  source,
  children
}: SetupGateProps): JSX.Element {
  const state = usePagePipeline(page, {
    ...(source !== undefined ? { source } : {}),
    ...(onSettled !== undefined ? { onSettled } : {})
  })
  const pipeline = state.pipeline
  if (pipeline === null) {
    return state.error !== null ? (
      <p className="ps-error" role="alert">
        {state.error}
      </p>
    ) : (
      <p role="status">Loading setup…</p>
    )
  }
  if (!stepDone(pipeline, waitingFor)) {
    return (
      <SetupPanel
        pipeline={pipeline}
        waitingFor={waitingFor}
        busy={state.busy}
        error={state.error}
        onStart={() => void state.start()}
        onStop={() => void state.stop()}
      />
    )
  }
  return <>{children({ ...state, pipeline })}</>
}
