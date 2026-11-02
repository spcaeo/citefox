import type { SetupRunStep } from '@shared/ipc'
import { isProjectClaudeProvider, type ClaudeHalt } from '../engine/claude-fallback'
import { PipelineError } from '../pipeline/errors'
import {
  generateBuyerProfile,
  generateBuyerPrompts,
  generateCoverage,
  readSetupPage,
  type PageSetupDeps
} from '../pipeline/setup'
import { getLatestCoverage } from '../storage/coverage-records'
import { getPage, setPageStatus } from '../storage/pages'

/** How one page's run ended. */
export type SetupRunOutcome =
  /** Prompts are saved and the page is tracked. `coverageError` is set when only coverage failed. */
  | { kind: 'done'; coverageError: string | null }
  /** The page is no longer setting up (paused, removed, or finished by hand). */
  | { kind: 'gone' }
  /** Stopped between steps (quit, pause, or the headless budget). The next run continues. */
  | { kind: 'aborted'; step: SetupRunStep }
  /** The project's Claude fallback rule stopped the call (FR-11.7, LLM-10). */
  | { kind: 'halted'; step: SetupRunStep; halt: ClaudeHalt }
  | { kind: 'failed'; step: SetupRunStep; message: string; nextStep: string | null; final: boolean }

export interface SetupRunHooks {
  shouldStop: () => boolean
  onStep: (step: SetupRunStep) => void
  /**
   * True when the user asked this page to fill its missing steps (Retry, or Write
   * content gaps on a tracked page): a tracked or paused page runs too, and keeps
   * its status.
   */
  fill?: boolean
}

const WORKING: ReadonlySet<string> = new Set(['setting_up', 'tracked', 'paused'])

/** A PipelineError the next try cannot fix: the page, project, or template is missing. */
const FINAL_CODES: ReadonlySet<string> = new Set(['not_found', 'template'])

/**
 * FR-1.7 without the stepper (owner feedback 5): read the page, write the buyer
 * profile, write the buyer prompts, mark the page tracked, then write the content
 * gaps (coverage matrix). The project's Claude connection, model, fallback and
 * templates are in `deps`. A step already stored is skipped, so a run stopped by a
 * quit continues where it was. Coverage never blocks tracking. No step spends a
 * search.
 */
export async function runSetupSteps(
  deps: PageSetupDeps,
  pageId: string,
  hooks: SetupRunHooks
): Promise<SetupRunOutcome> {
  const halted = (): ClaudeHalt | null =>
    isProjectClaudeProvider(deps.provider) ? deps.provider.halt() : null
  const open = (status: string | undefined): boolean =>
    status === 'setting_up' || (hooks.fill === true && status !== undefined && WORKING.has(status))
  let step: SetupRunStep = 'read'
  try {
    let page = getPage(deps.projectDb, pageId, deps.projectId)
    if (page === null || !open(page.status)) return { kind: 'gone' }
    if (page.setupStep === 'read') {
      if (page.url === null) {
        return {
          kind: 'failed',
          step,
          message: 'This topic has no page to read.',
          nextStep: 'Open the topic and edit its questions.',
          final: true
        }
      }
      if (hooks.shouldStop()) return { kind: 'aborted', step }
      hooks.onStep(step)
      await readSetupPage(deps, pageId)
    }
    step = 'profile'
    page = getPage(deps.projectDb, pageId, deps.projectId)
    if (page === null || !open(page.status)) return { kind: 'gone' }
    if (page.setupStep === 'profile') {
      if (hooks.shouldStop()) return { kind: 'aborted', step }
      hooks.onStep(step)
      await generateBuyerProfile(deps, pageId)
    }
    step = 'prompts'
    page = getPage(deps.projectDb, pageId, deps.projectId)
    if (page === null || !open(page.status)) return { kind: 'gone' }
    if (page.promptSetVersion === null) {
      if (hooks.shouldStop()) return { kind: 'aborted', step }
      hooks.onStep(step)
      await generateBuyerPrompts(deps, pageId)
    }
    page = getPage(deps.projectDb, pageId, deps.projectId)
    if (page === null || !open(page.status)) return { kind: 'gone' }
    // Prompts are saved: the page is tracked. Its first check still waits for the
    // user unless the project checks automatically (first_check_waits, migration 033).
    if (page.status === 'setting_up') {
      setPageStatus(deps.projectDb, pageId, 'tracked', deps.projectId)
    }
    // Content gaps are part of setup; a page that already has a matrix keeps it.
    if (getLatestCoverage(deps.projectDb, pageId, null) !== null) {
      return { kind: 'done', coverageError: null }
    }
    if (hooks.shouldStop()) return { kind: 'done', coverageError: null }
    step = 'coverage'
    hooks.onStep(step)
    try {
      await generateCoverage(deps, pageId)
      return { kind: 'done', coverageError: null }
    } catch (error) {
      if (halted() !== null) return { kind: 'halted', step, halt: halted() as ClaudeHalt }
      return { kind: 'done', coverageError: messageOf(error) }
    }
  } catch (error) {
    const halt = halted()
    if (halt !== null) return { kind: 'halted', step, halt }
    if (error instanceof PipelineError) {
      return {
        kind: 'failed',
        step,
        message: error.message,
        nextStep: error.nextStep,
        final: FINAL_CODES.has(error.code)
      }
    }
    return { kind: 'failed', step, message: messageOf(error), nextStep: null, final: false }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'Setup failed.'
}
