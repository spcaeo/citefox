import { useEffect, useMemo, useState } from 'react'
import type { QuestionRow, QuestionTarget, QuestionTargets, QuestionsList } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { AddQuestionsSource } from '../source'
import type { TargetKind } from '../types'
import { takesQuestions } from '../utils/copy'

export interface TargetsState {
  data: QuestionTargets | null
  /** Every tracked question (for "From tracked questions" and the stage counts). Null while loading. */
  tracked: QuestionsList | null
  loadError: string | null
  target: QuestionTarget | null
  /** The page or topic the URL names when it cannot take questions yet. */
  blocked: QuestionTarget | null
  kind: TargetKind
  /** Pages or topics of `kind` that take questions now. */
  choices: readonly QuestionTarget[]
  /** The tracked questions of the picked page or topic. */
  own: readonly QuestionRow[]
}

/**
 * The pages and topics Add questions can add to, and which one is picked: the
 * one the URL names (`topic=` or `page=`), else the first that takes questions.
 * `reload` bumps after an add, so counts and duplicates are fresh.
 */
export function useTargets(
  source: AddQuestionsSource,
  projectId: string,
  targetId: string | null,
  kindHint: TargetKind | null,
  reload: number
): TargetsState {
  const [data, setData] = useState<QuestionTargets | null>(null)
  const [tracked, setTracked] = useState<QuestionsList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    source['prompts:addTargets']({ projectId }).then(
      (loaded) => {
        if (live) setData(loaded)
      },
      (cause: unknown) => {
        if (live) setLoadError(errorText(cause, 'Could not load your pages and topics.'))
      }
    )
    source['questions:list']({ projectId }).then(
      (list) => {
        if (live) setTracked(list)
      },
      // The list only feeds counts and the tracked tab; the drawer works without it.
      () => {
        if (live) setTracked(null)
      }
    )
    return () => {
      live = false
    }
  }, [source, projectId, reload])

  return useMemo(() => {
    const named = data?.targets.find((item) => item.id === targetId) ?? null
    const blocked = named !== null && !takesQuestions(named) ? named : null
    const fallbackKind: TargetKind =
      kindHint ??
      (data !== null &&
      !data.targets.some((item) => item.kind === 'page' && takesQuestions(item)) &&
      data.targets.some((item) => item.kind === 'topic' && takesQuestions(item))
        ? 'topic'
        : 'page')
    const kind: TargetKind = named?.kind ?? fallbackKind
    const choices = data?.targets.filter((item) => item.kind === kind && takesQuestions(item)) ?? []
    const target =
      named !== null && blocked === null ? named : named === null ? (choices[0] ?? null) : null
    const own =
      target === null ? [] : (tracked?.rows.filter((row) => row.sourceId === target.id) ?? [])
    return { data, tracked, loadError, target, blocked, kind, choices, own }
  }, [data, tracked, loadError, targetId, kindHint])
}
