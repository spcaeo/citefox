import type { CoverageMatrix } from '@shared/domain'
import type {
  CoverageRunList,
  CoverageRunRequest,
  GenerateCoverageRequest,
  PageIdRequest,
  PromptIdRequest,
  SetGapDoneRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { generateCoverage, redoCoveragePrompt } from '../pipeline/setup'
import {
  getCoverageRun,
  getLatestCoverage,
  getLatestSnapshot,
  listCoverageRuns,
  updateCoverageRow
} from '../storage/content-records'
import { writeGapState } from '../storage/gap-states'
import type { EngineHost } from './host'
import { requirePage } from './page-access'
import { withProject } from './project-db'
import { pageSetupDeps } from './setup-deps'

export function getGaps(host: EngineHost, request: PageIdRequest): Promise<CoverageMatrix | null> {
  return withProject(host, request.projectId, 'gaps:get', (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, 'gaps:get')
    return getLatestCoverage(opened.db, request.pageId, snapshotHash(opened.db, request.pageId))
  })
}

export function generateGaps(
  host: EngineHost,
  request: GenerateCoverageRequest
): Promise<CoverageMatrix> {
  const channel = 'gaps:generate'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    const options = request.templateId === undefined ? {} : { templateId: request.templateId }
    return generateCoverage(
      pageSetupDeps(host, opened.db, request.projectId, channel),
      request.pageId,
      options
    )
  })
}

export function setGapDone(host: EngineHost, request: SetGapDoneRequest): Promise<CoverageMatrix> {
  const channel = 'gaps:setDone'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    const hash = snapshotHash(opened.db, request.pageId)
    const current = getLatestCoverage(opened.db, request.pageId, hash)
    if (current === null) {
      throw new PipelineError('There is no coverage matrix yet.', {
        code: 'not_found',
        nextStep: 'Run the coverage matrix, then mark a prompt done.'
      })
    }
    const row = current.rows.find((item) => item.promptId === request.promptId)
    if (row === undefined) {
      throw new PipelineError('That prompt is not in this matrix.', {
        code: 'not_found',
        nextStep: 'Choose a prompt from this matrix.'
      })
    }
    updateCoverageRow(opened.db, { ...row, done: request.done })
    // The status follows the done mark again (open, or published when done).
    writeGapState(
      opened.db,
      request.pageId,
      request.promptId,
      { status: null, ...(request.done ? {} : { publishedUrl: null }) },
      host.now().toISOString()
    )
    const stored = getLatestCoverage(opened.db, request.pageId, hash)
    if (stored === null) throw new IpcRequestError(channel, 'There is no coverage matrix yet.')
    return stored
  })
}

export function redoGap(host: EngineHost, request: PromptIdRequest): Promise<CoverageMatrix> {
  const channel = 'gaps:redo'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    return redoCoveragePrompt(
      pageSetupDeps(host, opened.db, request.projectId, channel),
      request.pageId,
      request.promptId
    )
  })
}

export function listCoverage(host: EngineHost, request: PageIdRequest): Promise<CoverageRunList> {
  return withProject(host, request.projectId, 'coverage:list', (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, 'coverage:list')
    return { pageId: request.pageId, runs: listCoverageRuns(opened.db, request.pageId) }
  })
}

export function getCoverage(
  host: EngineHost,
  request: CoverageRunRequest
): Promise<CoverageMatrix> {
  const channel = 'coverage:get'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    const matrix = getCoverageRun(
      opened.db,
      request.pageId,
      request.runId,
      snapshotHash(opened.db, request.pageId)
    )
    if (matrix === null) {
      throw new IpcRequestError(channel, 'That coverage run is not stored for this page.')
    }
    return matrix
  })
}

function snapshotHash(db: Parameters<typeof getLatestSnapshot>[0], pageId: string): string | null {
  return getLatestSnapshot(db, pageId)?.contentHash ?? null
}
