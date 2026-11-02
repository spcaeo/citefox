import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TopicStage } from '@shared/domain'
import type { ImportCommitResult, QuestionTarget } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { AddQuestionsSource } from '../source'
import type { DraftRow, RowCheck, RowCounts, RowOrigin, TargetKind } from '../types'
import {
  countRows,
  emptyRow,
  fillRows,
  isBlank,
  MAX_GRID_ROWS,
  rowValues,
  splitPaste,
  withTail,
  type PageOption
} from '../utils/rows'

/** Wait after the last keystroke before the rows are checked again. */
export const CHECK_DELAY_MS = 300

const NO_CHECKS: ReadonlyMap<string, RowCheck> = new Map()

/** The checks main gave back, and what they were asked for. */
interface Checked {
  request: readonly unknown[]
  targetId: string
  keywordRule: boolean
  checks: ReadonlyMap<string, RowCheck>
}

export interface RowsState {
  rows: readonly DraftRow[]
  checks: ReadonlyMap<string, RowCheck>
  checking: boolean
  counts: RowCounts
  defaultPage: string | null
  keywordRule: boolean
  adding: 'later' | 'now' | null
  error: string | null
  /** Rows typed, pasted or picked that closing would throw away. */
  dirty: boolean
  notice: string | null
}

export interface RowsActions {
  setCell: (key: string, patch: Partial<DraftRow>) => void
  remove: (key: string) => void
  /** A paste into row `key`: several lines or cells become rows from there. True when it was split. */
  paste: (key: string, text: string) => boolean
  addRows: (rows: readonly Partial<DraftRow>[], origin: RowOrigin) => number
  /** Rows saved earlier (a draft kept in main), each with its own origin. */
  restore: (rows: readonly Omit<DraftRow, 'key'>[]) => void
  setAll: (patch: Pick<Partial<DraftRow>, 'stage' | 'page'>) => void
  fill: (pages: readonly PageOption[]) => void
  keepBoth: (key: string) => void
  setDefaultPage: (page: string | null) => void
  setKeywordRule: (on: boolean) => void
  /** Adds the rows that check as new (and the similar ones kept) as one batch. */
  commit: (mode: 'later' | 'now') => Promise<ImportCommitResult | null>
  clearNotice: () => void
}

/** The rows of Add questions, their live checks against everything tracked, and the add. */
export function useAddQuestions(
  source: AddQuestionsSource,
  projectId: string,
  target: QuestionTarget | null,
  kind: TargetKind
): [RowsState, RowsActions] {
  const [rows, setRows] = useState<DraftRow[]>(() => withTail([]))
  const [checked, setChecked] = useState<Checked | null>(null)
  const [defaultPage, setDefaultPage] = useState<string | null>(null)
  const [keywordRule, setKeywordRule] = useState(true)
  const [adding, setAdding] = useState<RowsState['adding']>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  // A page's own address is its default page; a topic starts with none picked.
  const targetId = target?.id ?? null
  const targetUrl = target?.url ?? null
  const defaultKey = `${kind}|${targetId ?? ''}|${targetUrl ?? ''}`
  const [defaultFor, setDefaultFor] = useState(defaultKey)
  if (defaultFor !== defaultKey) {
    setDefaultFor(defaultKey)
    setDefaultPage(kind === 'page' ? targetUrl : null)
  }

  const filled = useMemo(() => rows.filter((row) => !isBlank(row)), [rows])
  const request = useMemo(
    () =>
      filled.map((row) => ({
        key: row.key,
        values: rowValues(row, kind, defaultPage),
        keep: row.keep
      })),
    [filled, kind, defaultPage]
  )

  // Every change is checked again a moment after the last one; older answers are dropped.
  const idle = targetId === null || request.length === 0
  useEffect(() => {
    if (targetId === null || request.length === 0) return
    let current = true
    const timer = window.setTimeout(() => {
      source['import:validate']({
        projectId,
        entity: 'questions',
        targetId,
        rules: { keywords: keywordRule },
        rows: request
      }).then(
        (result) => {
          if (!current) return
          setChecked({
            request,
            targetId,
            keywordRule,
            checks: new Map(result.rows.map((row) => [row.key, row]))
          })
        },
        (cause: unknown) => {
          if (!current) return
          setError(errorText(cause, 'Could not check the questions.', { sentence: true }))
          setChecked({ request, targetId, keywordRule, checks: new Map() })
        }
      )
    }, CHECK_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [source, projectId, targetId, keywordRule, request])
  // The last answer stays on screen while the next one is on its way.
  const checks = idle || checked === null ? NO_CHECKS : checked.checks
  const checking =
    !idle &&
    (checked === null ||
      checked.request !== request ||
      checked.targetId !== targetId ||
      checked.keywordRule !== keywordRule)

  const setCell = useCallback((key: string, patch: Partial<DraftRow>) => {
    setRows((current) =>
      withTail(
        current.map((row) => {
          if (row.key !== key) return row
          // Editing the words asks again whether a similar row is kept; a new topic or
          // market asks again whether to create or add it.
          const keep =
            patch.question !== undefined && patch.question !== row.question ? false : row.keep
          const createTopic =
            patch.topic !== undefined && patch.topic !== row.topic ? false : row.createTopic
          const addMarket =
            patch.market !== undefined && patch.market !== row.market ? false : row.addMarket
          return { ...row, keep, createTopic, addMarket, ...patch }
        })
      )
    )
    setError(null)
  }, [])

  const remove = useCallback((key: string) => {
    setRows((current) => withTail(current.filter((row) => row.key !== key)))
  }, [])

  const addRows = useCallback(
    (incoming: readonly Partial<DraftRow>[], origin: RowOrigin): number => {
      let added = 0
      setRows((current) => {
        const kept = current.filter((row) => !isBlank(row))
        const room = Math.max(0, MAX_GRID_ROWS - kept.length)
        const next = incoming.slice(0, room).map((row) => ({ ...emptyRow(origin), ...row, origin }))
        added = next.length
        if (incoming.length > room) {
          setNotice(
            `Only ${MAX_GRID_ROWS.toLocaleString('en-US')} rows fit here. Use Import a file for more.`
          )
        }
        return withTail([...kept, ...next])
      })
      return added
    },
    []
  )

  const restore = useCallback((saved: readonly Omit<DraftRow, 'key'>[]) => {
    setRows((current) => {
      const kept = current.filter((row) => !isBlank(row))
      const room = Math.max(0, MAX_GRID_ROWS - kept.length)
      const next = saved.slice(0, room).map((row) => ({ ...emptyRow(row.origin), ...row }))
      return withTail([...kept, ...next])
    })
  }, [])

  const paste = useCallback((key: string, text: string): boolean => {
    const split = splitPaste(text)
    if (split === null || split.length === 0) return false
    setRows((current) => {
      const at = current.findIndex((row) => row.key === key)
      const before = at < 0 ? current : current.slice(0, at)
      const target = at < 0 ? null : (current[at] ?? null)
      const after = at < 0 ? [] : current.slice(at + 1)
      // The first pasted row lands in the row pasted into (when it was empty).
      const first =
        target !== null && isBlank(target)
          ? [{ ...target, ...split[0], origin: 'typed' as const }]
          : []
      const rest = (first.length > 0 ? split.slice(1) : split).map((row) => ({
        ...emptyRow('typed'),
        ...row
      }))
      const keepTarget = target !== null && !isBlank(target) ? [target] : []
      const next = [
        ...before,
        ...keepTarget,
        ...first,
        ...rest,
        ...after.filter((row) => !isBlank(row))
      ]
      return withTail(next.slice(0, MAX_GRID_ROWS + 1))
    })
    return true
  }, [])

  const setAll = useCallback((patch: Pick<Partial<DraftRow>, 'stage' | 'page'>) => {
    setRows((current) => current.map((row) => (isBlank(row) ? row : { ...row, ...patch })))
  }, [])

  const fill = useCallback(
    (pages: readonly PageOption[]) => {
      setRows((current) => {
        const result = fillRows(current, pages, kind)
        setNotice(
          result.stages + result.pages === 0
            ? 'Every row already has a stage and a page.'
            : `Matched ${result.stages} ${result.stages === 1 ? 'stage' : 'stages'}${kind === 'topic' ? ` and ${result.pages} ${result.pages === 1 ? 'page' : 'pages'}` : ''} by keywords in each question. Check them before adding.`
        )
        return result.rows
      })
    },
    [kind]
  )

  const keepBoth = useCallback((key: string) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, keep: true } : row)))
  }, [])

  const commit = useCallback(
    async (mode: 'later' | 'now'): Promise<ImportCommitResult | null> => {
      if (targetId === null || adding !== null) return null
      const ready = filled.filter((row) => {
        const check = checks.get(row.key)
        return check !== undefined && (check.result === 'new' || check.result === 'keyword')
      })
      if (ready.length === 0) return null
      setAdding(mode)
      setError(null)
      try {
        const result = await source['import:commit']({
          projectId,
          entity: 'questions',
          targetId,
          rules: { keywords: keywordRule },
          rows: ready.map((row) => ({ values: rowValues(row, kind, defaultPage), keep: row.keep }))
        })
        if (live.current) setAdding(null)
        if (result.added === 0) {
          if (live.current) {
            setError(result.skipped[0]?.reason ?? result.message)
          }
          return null
        }
        return result
      } catch (cause) {
        if (live.current) {
          setError(errorText(cause, 'Could not add the questions.', { sentence: true }))
          setAdding(null)
        }
        return null
      }
    },
    [source, projectId, targetId, adding, filled, checks, keywordRule, kind, defaultPage]
  )

  const counts = useMemo(() => countRows(rows, checks), [rows, checks])

  return [
    {
      rows,
      checks,
      checking,
      counts,
      defaultPage,
      keywordRule,
      adding,
      error,
      dirty: filled.length > 0,
      notice
    },
    {
      setCell,
      remove,
      paste,
      addRows,
      restore,
      setAll,
      fill,
      keepBoth,
      setDefaultPage,
      setKeywordRule,
      commit,
      clearNotice: () => setNotice(null)
    }
  ]
}

/** A stage picked for all rows, or '' to clear. */
export type StagePick = TopicStage | ''
