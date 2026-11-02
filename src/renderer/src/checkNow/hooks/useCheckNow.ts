import { useEffect, useMemo, useState } from 'react'
import { MAX_NOT_CITED_PAGES } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useScopeOptions, type PickerItem, type ScopeOptions } from '../../scope'
import {
  buildPlan,
  scopePageIds,
  type CheckNowState,
  type CheckPlan,
  type NotCitedMap
} from '../model'
import type { CheckNowSource } from '../source'

export interface CheckNowData {
  options: ScopeOptions | null
  error: string | null
  reload: () => void
  plan: CheckPlan | null
  /** The one page (or topic) in scope, when the scope covers exactly one. */
  onlyPageId: string | null
  /** That page's questions, for "Questions I pick". Null while they load or with no single page. */
  questions: readonly PickerItem[] | null
  questionsError: string | null
  notCitedError: string | null
}

/**
 * Check now's data: the scope options, then (only when asked) the questions
 * not cited last time for the pages in scope and one page's question list,
 * and the plan Run check would start. Every input comes from the URL state.
 */
export function useCheckNow(
  projectId: string,
  state: CheckNowState,
  source: CheckNowSource
): CheckNowData {
  const { options, error, reload } = useScopeOptions(projectId, source)
  // "Now" is when the options loaded, so the due list does not move while the drawer is open.
  const now = useMemo(() => (options ? new Date() : new Date(0)), [options])
  const pageIds = useMemo(
    () => (options ? scopePageIds(state, options, now) : []),
    [options, state, now]
  )
  const onlyPageId = pageIds.length === 1 ? (pageIds[0] ?? null) : null
  const notCited = useNotCited(
    source,
    projectId,
    state.only === 'notcited' && options !== null ? pageIds : null,
    state.markets
  )
  const questions = usePageQuestions(source, projectId, state.only === 'picked' ? onlyPageId : null)

  const plan = useMemo(
    () =>
      options
        ? buildPlan({
            state,
            options,
            notCited: notCited.map,
            pageQuestions: questions.items ? questions.items.map((item) => item.id) : null,
            now
          })
        : null,
    [options, state, notCited.map, questions.items, now]
  )

  return {
    options,
    error,
    reload,
    plan,
    onlyPageId,
    questions: questions.items,
    questionsError: questions.error,
    notCitedError: notCited.error
  }
}

function useNotCited(
  source: CheckNowSource,
  projectId: string,
  pageIds: readonly string[] | null,
  markets: readonly string[]
): { map: NotCitedMap | null; error: string | null } {
  const key = pageIds === null ? null : `${pageIds.join(',')}|${markets.join(',')}`
  const [result, setResult] = useState<{
    key: string
    map: NotCitedMap | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (key === null || pageIds === null) return
    let live = true
    Promise.resolve()
      .then(() =>
        source['checks:notCited']({
          projectId,
          pageIds: pageIds.slice(0, MAX_NOT_CITED_PAGES),
          marketIds: markets.length > 0 ? [...markets] : null
        })
      )
      .then(
        (list) => {
          if (!live) return
          const map: NotCitedMap = new Map(
            list.pages.map((page) => [
              page.pageId,
              {
                promptIds: page.promptIds,
                marketIds: page.markets.map((market) => market.marketId)
              }
            ])
          )
          setResult({ key, map, error: null })
        },
        (cause: unknown) => {
          if (live) {
            setResult({
              key,
              map: new Map(),
              error: errorText(cause, 'Could not read the last check.')
            })
          }
        }
      )
    return () => {
      live = false
    }
    // `key` stands for the page and market lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, projectId, key])

  if (key === null || result?.key !== key) return { map: null, error: null }
  return { map: result.map, error: result.error }
}

function usePageQuestions(
  source: CheckNowSource,
  projectId: string,
  pageId: string | null
): { items: readonly PickerItem[] | null; error: string | null } {
  const [result, setResult] = useState<{
    pageId: string
    items: PickerItem[] | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (pageId === null) return
    let live = true
    Promise.resolve()
      .then(() => source['prompts:list']({ projectId, pageId }))
      .then(
        (view) => {
          if (!live) return
          const items = view.prompts
            .filter((prompt) => prompt.enabled)
            .map((prompt) => ({
              id: prompt.id,
              label: prompt.variants[0]?.text || prompt.label,
              detail: `Q${prompt.position}`
            }))
          setResult({ pageId, items, error: null })
        },
        (cause: unknown) => {
          if (live) {
            setResult({
              pageId,
              items: [],
              error: errorText(cause, 'Could not load the questions.')
            })
          }
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, pageId])

  if (pageId === null || result?.pageId !== pageId) return { items: null, error: null }
  return { items: result.items, error: result.error }
}
