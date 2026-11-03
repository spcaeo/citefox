import { useEffect, useMemo, useState } from 'react'
import { MAX_NOT_CITED_PAGES, type ProjectHistory } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useScopeOptions, type PickerItem, type ScopeOptions } from '../../scope'
import {
  buildPlan,
  failedCounts,
  failedMap,
  scopePageIds,
  withDefaultScope,
  type CheckNowState,
  type CheckPlan,
  type NotCitedMap
} from '../model'
import type { CheckNowSource } from '../source'

export interface CheckNowData {
  /** The state to show: the URL's, with the default scope when the URL has none. */
  state: CheckNowState
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
  /**
   * Questions with no usable result in their last check, within the scope and
   * markets. Null while the checks load.
   */
  failed: { questions: number; pages: number } | null
}

/**
 * Check now's data: the scope options, then (only when asked) the questions
 * not cited last time for the pages in scope and one page's question list,
 * and the plan Run check would start. Every input comes from the URL state;
 * `scopeChosen` is false when the URL has no scope, and the first scope with
 * something to check is used (see `defaultScope`).
 */
export function useCheckNow(
  projectId: string,
  parsed: CheckNowState,
  source: CheckNowSource,
  scopeChosen = true
): CheckNowData {
  const { options, error, reload } = useScopeOptions(projectId, source)
  // "Now" is when the options loaded, so the due list does not move while the drawer is open.
  const now = useMemo(() => (options ? new Date() : new Date(0)), [options])
  const state = useMemo(
    () => withDefaultScope(parsed, scopeChosen, options, now),
    [parsed, scopeChosen, options, now]
  )
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
  const history = useHistory(source, projectId, options)
  const failedAll = useMemo(
    () =>
      history.data
        ? failedMap(history.data, state.markets.length > 0 ? state.markets : null)
        : null,
    [history.data, state.markets]
  )
  // A history that cannot be read means nothing is known to have failed.
  const failedList = useMemo(
    () => failedAll ?? (history.error ? new Map<string, never>() : null),
    [failedAll, history.error]
  )
  const questions = usePageQuestions(source, projectId, state.only === 'picked' ? onlyPageId : null)

  const plan = useMemo(
    () =>
      options
        ? buildPlan({
            state,
            options,
            notCited: notCited.map,
            failed: failedList,
            pageQuestions: questions.items ? questions.items.map((item) => item.id) : null,
            now
          })
        : null,
    [options, state, notCited.map, failedList, questions.items, now]
  )

  return {
    state,
    options,
    error,
    reload,
    plan,
    onlyPageId,
    questions: questions.items,
    questionsError: questions.error,
    notCitedError: notCited.error,
    failed: failedCounts(failedList, pageIds)
  }
}

/** `history:listProject` once the pages are known: the checks and their failed questions. */
function useHistory(
  source: CheckNowSource,
  projectId: string,
  /** The loaded pages: the checks are read again whenever they are. */
  options: ScopeOptions | null
): { data: ProjectHistory | null; error: boolean } {
  const [result, setResult] = useState<{ data: ProjectHistory | null; error: boolean } | null>(null)
  useEffect(() => {
    if (options === null) return
    let live = true
    Promise.resolve()
      .then(() => source['history:listProject']({ projectId }))
      .then(
        (data) => {
          if (live) setResult({ data, error: false })
        },
        () => {
          if (live) setResult({ data: null, error: true })
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, options])
  return result ?? { data: null, error: false }
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
