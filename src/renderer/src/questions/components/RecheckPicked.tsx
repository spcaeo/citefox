import { useEffect, useMemo, useState, type JSX } from 'react'
import type { QuestionRow, QuestionSource } from '@shared/ipc'
import { RecheckBody } from '../../questionEdit/RecheckConfirm'
import { Confirm } from '../../ui'
import { costLine, costProblem, countText, recheckPlan, type RecheckPlan } from '../model'

/**
 * "Check N questions now?" over the Questions list (`?confirm=recheck&pick=<ids>`):
 * the search cost in the list's market and what is left this month. The picked
 * questions come from the URL, so a copied link asks the same question.
 */
export function RecheckPicked({
  rows,
  sources,
  marketLabel,
  searchesLeft: loadLeft,
  onCancel,
  onConfirm
}: {
  /** The picked questions still in the list. */
  rows: readonly QuestionRow[]
  sources: ReadonlyMap<string, QuestionSource>
  marketLabel: string
  /** Searches left this month, from the status capsule. Null when unknown. */
  searchesLeft: () => Promise<number | null>
  onCancel: () => void
  onConfirm: (plan: RecheckPlan) => void
}): JSX.Element {
  const plan = useMemo(() => recheckPlan(rows, sources), [rows, sources])
  const [left, setLeft] = useState<{ loaded: boolean; value: number | null }>({
    loaded: false,
    value: null
  })

  useEffect(() => {
    let cancelled = false
    void loadLeft().then((value) => {
      if (!cancelled) setLeft({ loaded: true, value })
    })
    return () => {
      cancelled = true
    }
  }, [loadLeft])

  const problem =
    rows.length === 0
      ? 'These questions are not in the list any more.'
      : costProblem(plan, left.value)
  return (
    <Confirm
      title={`Check ${countText(plan.promptIds.length, 'question')} now?`}
      tone="default"
      body={<RecheckBody body={costLine(plan, marketLabel, left.value)} problem={problem} />}
      confirmLabel="Check now"
      confirmDisabled={problem !== null || !left.loaded}
      onCancel={onCancel}
      onConfirm={() => onConfirm(plan)}
      testId="recheck-confirm"
    />
  )
}
