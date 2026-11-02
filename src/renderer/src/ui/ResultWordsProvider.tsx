import { useMemo, type JSX, type ReactNode } from 'react'
import type { EngineId } from '@shared/domain'
import { ResultWordsContext, resultWords, WHOLE_SITE_CITED } from './resultWords'

/**
 * The picked engine for every result word below it (bars, legends, cells, drills), so a
 * screen on ChatGPT says "No answer" where Google says "No AI Overview".
 */
export function ResultWordsProvider({
  engine,
  wholeSite = false,
  children
}: {
  engine: EngineId | 'all' | null | undefined
  /** No target page yet: a cited own page reads "Your page cited". */
  wholeSite?: boolean
  children: ReactNode
}): JSX.Element {
  const words = useMemo(
    () => ({ ...resultWords(engine), ...(wholeSite ? { cited: WHOLE_SITE_CITED } : {}) }),
    [engine, wholeSite]
  )
  return <ResultWordsContext.Provider value={words}>{children}</ResultWordsContext.Provider>
}
