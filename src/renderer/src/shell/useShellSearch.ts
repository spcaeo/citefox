import { useCallback, useEffect, useState } from 'react'
import type { PageSummary } from '@shared/domain'
import type { QuestionSearchHit } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { useLatest } from '../components/useLatest'
import type { ShellClient } from '../projects/client'
import type { QuestionSearchSource } from './questionSearch'
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue'

/** What `search:questions` gave for the typed query. */
export interface QuestionMatches {
  hits: readonly QuestionSearchHit[]
  /** More questions match than were returned. */
  more: boolean
  /** The lookup failed; the box says so in place of the questions. */
  failed: boolean
}

export interface ShellSearch {
  query: string
  setQuery: (query: string) => void
  /** Pages matching the typed query in the open project. Null while it searches or with no query. */
  pages: readonly PageSummary[] | null
  /** Questions matching the typed query in the open project. Null while it searches or with no query. */
  questions: QuestionMatches | null
  /** Clears the box and the last result (a project switch). */
  reset: () => void
}

/** A lookup's answer, kept with the project and query it was asked for. */
interface Answer<T> {
  projectId: string
  query: string
  value: T
}

/**
 * The top bar search's page lookup (`pages:search`) and question lookup
 * (`search:questions`), both run once typing pauses for `SEARCH_DEBOUNCE_MS`.
 * A result only shows for the project and query it was asked for, and an
 * effect's cleanup drops a response that comes back after the query moved on,
 * so a slow answer never lands on a newer query. A failed page search goes to
 * the shell's error line as before; a failed question search only marks its
 * own group, so pages and topics stay usable (and harness pages without the
 * preload bridge show no error banner while typing).
 */
export function useShellSearch(
  client: ShellClient,
  questionSource: QuestionSearchSource,
  projectId: string | null,
  onError: (message: string) => void
): ShellSearch {
  const [query, setQuery] = useState('')
  const [pageAnswer, setPageAnswer] = useState<Answer<readonly PageSummary[]> | null>(null)
  const [questionAnswer, setQuestionAnswer] = useState<Answer<QuestionMatches> | null>(null)
  const settled = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const reportError = useLatest(onError)

  useEffect(() => {
    if (!projectId || !settled) return
    let cancelled = false
    void client.searchPages({ projectId, query: settled }).then(
      (found) => {
        if (!cancelled) setPageAnswer({ projectId, query: settled, value: found.pages })
      },
      (error: unknown) => {
        if (cancelled) return
        setPageAnswer({ projectId, query: settled, value: [] })
        reportError.current(errorText(error, 'Could not search pages.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [settled, projectId, client, reportError])

  useEffect(() => {
    if (!projectId || !settled) return
    let cancelled = false
    void questionSource['search:questions']({ projectId, query: settled }).then(
      (found) => {
        if (cancelled) return
        const value = { hits: found.questions, more: found.more, failed: false }
        setQuestionAnswer({ projectId, query: settled, value })
      },
      () => {
        if (cancelled) return
        const value = { hits: [], more: false, failed: true }
        setQuestionAnswer({ projectId, query: settled, value })
      }
    )
    return () => {
      cancelled = true
    }
  }, [settled, projectId, questionSource])

  const trimmed = query.trim()
  function current<T>(answer: Answer<T> | null): T | null {
    return projectId && trimmed && answer?.projectId === projectId && answer.query === trimmed
      ? answer.value
      : null
  }

  const reset = useCallback(() => {
    setQuery('')
    setPageAnswer(null)
    setQuestionAnswer(null)
  }, [])

  return {
    query,
    setQuery,
    pages: current(pageAnswer),
    questions: current(questionAnswer),
    reset
  }
}
