import { useEffect, useMemo, useState, type JSX } from 'react'
import type { ImportRow, QuestionTargets } from '@shared/ipc'
import { ImportDrawer } from '../importFlow/ImportDrawer'
import type { ImportFilter, ImportStep } from '../importFlow/model'
import type { ImportSource } from '../importFlow/source'
import { AddPageDrawer } from './components/AddPageDrawer'
import { createAddQuestionsSource, type AddQuestionsSource } from './source'
import { checkCost } from './utils/copy'
import { pageOptions, siteOf, targetMarkets } from './utils/targets'

/** The pages and topics, read again by each stacked drawer so a reload keeps working. */
function useTargetData(
  source: Pick<AddQuestionsSource, 'prompts:addTargets'>,
  projectId: string
): QuestionTargets | null {
  const [data, setData] = useState<QuestionTargets | null>(null)
  useEffect(() => {
    let live = true
    source['prompts:addTargets']({ projectId }).then(
      (loaded) => {
        if (live) setData(loaded)
      },
      () => {
        if (live) setData(null)
      }
    )
    return () => {
      live = false
    }
  }, [source, projectId])
  return data
}

export interface ImportQuestionsDrawerProps {
  projectId: string
  /** The page or topic of the Add questions drawer underneath. */
  targetId: string | null
  step: ImportStep
  filter: ImportFilter
  onStep: (step: ImportStep) => void
  onFilter: (filter: ImportFilter) => void
  onClose: () => void
  /** The checked rows go back into Add questions' grid. */
  onReturn: (rows: readonly ImportRow[]) => void
  source?: AddQuestionsSource
  importSource?: ImportSource
}

/** "… › Add questions › Import a file": the shared import step for questions. */
export function ImportQuestionsDrawer({
  projectId,
  targetId,
  step,
  filter,
  onStep,
  onFilter,
  onClose,
  onReturn,
  source: given,
  importSource
}: ImportQuestionsDrawerProps): JSX.Element {
  const source = useMemo(() => given ?? createAddQuestionsSource(), [given])
  const data = useTargetData(source, projectId)
  const target = data?.targets.find((item) => item.id === targetId) ?? null
  const markets = targetMarkets(data, target)
  // The target's markets first (the first is the default), then the project's others,
  // so a row naming a market the target does not check still shows its name.
  const labelled = [
    ...markets,
    ...(data?.markets ?? []).filter((market) => !markets.some((item) => item.id === market.id))
  ]
  return (
    <ImportDrawer
      projectId={projectId}
      entity="questions"
      targetId={targetId}
      step={step}
      filter={filter}
      onStep={onStep}
      onFilter={onFilter}
      onClose={onClose}
      mode="return"
      onReturn={onReturn}
      pages={pageOptions(data)}
      defaultPage={target?.kind === 'page' ? target.url : null}
      markets={labelled}
      site={siteOf(data)}
      costLine={(count) => {
        if (target === null || count === 0) return null
        const { min, max } = checkCost(count, markets.length, target.samples)
        const left =
          data?.searchesLeft === null || data === null
            ? ''
            : ` · ${data.searchesLeft.toLocaleString('en-US')} left`
        return `checking them uses ${min.toLocaleString('en-US')}${max > min ? `–${max.toLocaleString('en-US')}` : ''} searches${left}`
      }}
      {...(importSource ? { source: importSource } : {})}
    />
  )
}

export interface AddPageForTargetProps {
  projectId: string
  targetId: string | null
  url: string
  label: string
  onChange: (patch: { url?: string; label?: string }) => void
  onClose: () => void
  onAdded: (url: string) => void
  source?: AddQuestionsSource
}

/** "… › Add questions › Add a page", checked in the markets of the topic underneath. */
export function AddPageForTarget({
  projectId,
  targetId,
  source: given,
  ...rest
}: AddPageForTargetProps): JSX.Element {
  const source = useMemo(() => given ?? createAddQuestionsSource(), [given])
  const data = useTargetData(source, projectId)
  const target = data?.targets.find((item) => item.id === targetId) ?? null
  const markets = target === null ? (data?.markets ?? []) : targetMarkets(data, target)
  return (
    <AddPageDrawer
      projectId={projectId}
      markets={markets}
      site={siteOf(data)}
      source={source}
      {...rest}
    />
  )
}
