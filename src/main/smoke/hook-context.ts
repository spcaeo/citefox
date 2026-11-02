import type { IpcHandlersFor, topicsChannels } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import type { PageSetupDeps } from '../pipeline/setup'
import type { AppStorage } from '../storage'
import type { SmokeArgs, SmokeIo, SmokeReport, SmokeStage } from './live'
import type { TopicSmokeSummary } from './topic-args'

/**
 * What the live smoke hands the prompt-audit hooks, and what they give back
 * (Docs/PROMPT-AUDIT.md, P0 item 9). The hook files import from here; `hooks.ts`
 * decides when each runs.
 */

/** What a hook did. `detail` is printed when a requested hook did not run. */
export interface SmokeHookResult {
  ran: boolean
  detail: string
}

/** The result of a hook its package has not written yet. */
export function notWrittenYet(pkg: string): SmokeHookResult {
  return { ran: false, detail: `not written yet (package ${pkg} of Docs/PROMPT-AUDIT.md)` }
}

/** What the page smoke hands its hooks, after the score step. */
export interface PageSmokeHookContext {
  io: SmokeIo
  /** Prints and records a stage, as the page smoke's own steps do (use with `step`). */
  push: (stage: SmokeStage) => void
  secrets: readonly string[]
  args: SmokeArgs
  report: SmokeReport
  /** The page-setup dependencies: app and project databases, Claude, transport, keys. */
  setup: PageSetupDeps
  storage: AppStorage
  /** The check engine the search ran on; reports and sentiment read its run. */
  engine: CheckEngine
  projectId: string
  pageId: string
  marketId: string
  /** The run the search step finished. Null when the engine returned none. */
  runId: string | null
  /** SerpApi searches sent so far in this smoke. */
  searches: () => number
  clock: () => Date
}

type TopicHandlers = IpcHandlersFor<typeof topicsChannels>

/** What the topic smoke hands its hooks, after "why not cited". */
export interface TopicSmokeHookContext {
  io: SmokeIo
  push: (stage: SmokeStage) => void
  secrets: readonly string[]
  args: SmokeArgs & { topic: string }
  summary: TopicSmokeSummary
  /** The real `topics:*` handlers over the temp data directory. */
  handlers: TopicHandlers
  storage: AppStorage
  projectId: string
  draftId: string
  topicId: string
  marketId: string
  searches: () => number
}
