import type { BuildTools } from '../buildMenu/buildClient'
import { checkError, checkStartMessage } from '../m3/source'
import { pageHash, sectionHash } from '../shell/routes'
import type { CheckNowSource } from './source'
import { finishedText, startedText, type CheckPlan } from './model'

/** Where a check's toast links: one page's Results, else Status (running and waiting checks). */
export function checkLink(pageIds: readonly string[]): { label: string; href: string } {
  const only = pageIds.length === 1 ? pageIds[0] : undefined
  return only === undefined
    ? { label: 'See progress', href: sectionHash('status') }
    : { label: 'Open results', href: pageHash(only, 'results') }
}

/**
 * Starts the plan's check and returns at once. `checks:start` resolves when
 * the job ends (Docs: never await it in the UI), so the window's toast says it
 * started, then says how it ended.
 */
export function runCheck(
  source: Pick<CheckNowSource, 'checks:start'>,
  notify: BuildTools['notify'],
  projectId: string,
  plan: Pick<CheckPlan, 'pageIds' | 'marketIds' | 'promptIds' | 'estimate'>
): boolean {
  const [first, ...rest] = plan.pageIds
  if (first === undefined) return false
  const link = checkLink(plan.pageIds)
  notify(startedText(plan), 'ok', link)
  Promise.resolve()
    .then(() =>
      source['checks:start']({
        projectId,
        pageIds: [first, ...rest],
        marketIds: plan.marketIds,
        promptIds: plan.promptIds
      })
    )
    .then(
      (job) => {
        if (job.status === 'finished') notify(finishedText(job.pageIds.length), 'ok', link)
        else if (job.status !== 'running') notify(checkStartMessage(job), 'bad', link)
      },
      (cause: unknown) => notify(checkError(cause, 'The check did not start.'), 'bad', link)
    )
  return true
}
