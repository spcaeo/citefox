import { useEffect, useState, type JSX } from 'react'
import { checkError, checkStartMessage } from '../m3/source'
import { costLine, costProblem, countText } from '../questions/model'
import { notifyTopicsChanged } from '../topics/clusters'
import { Confirm, showUndo } from '../ui'

/**
 * The body of a re-check confirm: what happens, the search cost (quieter), and why
 * it cannot go ahead when it cannot (the confirm button is off then).
 */
export function RecheckBody({
  body,
  detail,
  problem
}: {
  body: string
  detail?: string | null
  problem?: string | null
}): JSX.Element {
  return (
    <>
      <p>{body}</p>
      {detail ? <p className="faint">{detail}</p> : null}
      {problem ? (
        <p className="ui-drawer-error" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  )
}
import { recheckPlanOf, type RecheckRequest } from './recheck'
import type { QuestionEditSource } from './source'

/**
 * "Check N questions now?" with the search cost and what is left this month, then
 * `checks:start` for just those questions in that market. The toast says how it went.
 */
export function RecheckConfirm({
  source,
  projectId,
  request,
  onClose
}: {
  source: QuestionEditSource
  projectId: string
  request: RecheckRequest
  onClose: () => void
}): JSX.Element {
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null)
  const plan = recheckPlanOf(request)

  useEffect(() => {
    let cancelled = false
    // Only feeds the cost line; a failure leaves the count out.
    Promise.resolve()
      .then(() => source['status:getCapsule']())
      .then(
        (capsule) => {
          if (!cancelled) setSearchesLeft(capsule.searchesLeft)
        },
        () => undefined
      )
    return () => {
      cancelled = true
    }
  }, [source])

  const what = countText(plan.promptIds.length, 'question')
  const run = async (): Promise<void> => {
    onClose()
    const [first, ...rest] = plan.pageIds
    if (first === undefined) return
    try {
      const job = await source['checks:start']({
        projectId,
        pageIds: [first, ...rest],
        marketIds: [request.marketId],
        promptIds: plan.promptIds
      })
      notifyTopicsChanged()
      showUndo({
        message:
          job.status === 'finished'
            ? `Checked ${what} in ${request.marketLabel}. Used ${countText(job.searchesUsed, 'search', 'searches')}.`
            : job.status === 'running'
              ? `Checking ${what} in ${request.marketLabel}…`
              : checkStartMessage(job)
      })
    } catch (cause) {
      showUndo({ message: checkError(cause, 'Could not start the check.') })
    }
  }

  const problem = costProblem(plan, searchesLeft)
  return (
    <Confirm
      title={`Check ${what} now?`}
      tone="default"
      body={
        <RecheckBody
          body="A fresh search for each, in this market only. Results show as a follow-up check."
          detail={costLine(plan, request.marketLabel, searchesLeft)}
          problem={problem}
        />
      }
      confirmLabel="Check now"
      confirmDisabled={problem !== null}
      onCancel={onClose}
      onConfirm={() => void run()}
      testId="recheck-confirm"
    />
  )
}
