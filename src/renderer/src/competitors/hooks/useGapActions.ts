import { useCallback, useEffect, useState } from 'react'
import type { CitedSiteRow, CompetitorGapQuestion } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { SortableSiteKind } from '@shared/report/site-kinds'
import { errorText } from '../../components/errorText'
import { openDrawer } from '../../shell/drawers'
import type { CompetitorsSource } from '../source'

export interface GapTopic {
  id: string
  name: string
}

export interface GapActions {
  /** Topics that take questions (tracked or paused), for "Add to a topic". */
  topics: readonly GapTopic[]
  adding: boolean
  sorting: boolean
  /** What the last action did, or why it failed. */
  message: string | null
  error: boolean
  addToTopic: (topicId: string, gaps: readonly CompetitorGapQuestion[]) => Promise<void>
  /** "+ New topic…": the new-topic drawer, then the questions go to the topic it makes. */
  addToNewTopic: (gaps: readonly CompetitorGapQuestion[]) => void
  /** The fix drawer for the page with the most of these questions, those questions picked. */
  logFix: (gaps: readonly CompetitorGapQuestion[]) => void
  setKind: (row: CitedSiteRow, kind: SortableSiteKind) => Promise<void>
}

/** The gap drawer's actions. `rowId` is the open row; a new row starts with no message. */
export function useGapActions(
  source: CompetitorsSource,
  projectId: string,
  rowId: string | null,
  onChanged: () => void
): GapActions {
  const [topics, setTopics] = useState<readonly GapTopic[]>([])
  const [adding, setAdding] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [said, setSaid] = useState<{ rowId: string | null; text: string; error: boolean } | null>(
    null
  )
  const [reloads, setReloads] = useState(0)
  const say = useCallback(
    (text: string | null, error = false) => setSaid(text === null ? null : { rowId, text, error }),
    [rowId]
  )
  // A message is about the row it was said for; another row starts clean.
  const message = said !== null && said.rowId === rowId ? said.text : null
  const error = said !== null && said.rowId === rowId && said.error

  useEffect(() => {
    if (rowId === null) return
    let live = true
    void Promise.resolve()
      .then(() => source['prompts:addTargets']({ projectId }))
      .then(
        (targets) => {
          if (!live) return
          setTopics(
            targets.targets
              .filter(
                (item) =>
                  item.kind === 'topic' && (item.status === 'tracked' || item.status === 'paused')
              )
              .map((item) => ({ id: item.id, name: item.name }))
          )
        },
        () => {
          if (live) setTopics([])
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, rowId, reloads])

  const addToTopic = useCallback(
    async (topicId: string, gaps: readonly CompetitorGapQuestion[]): Promise<void> => {
      const texts = [...new Set(gaps.map((gap) => gap.promptText.trim()).filter(Boolean))]
      setAdding(true)
      say(null)
      try {
        const result = await source['prompts:addQuestions']({
          projectId,
          pageId: topicId,
          questions: texts.map((text) => ({ text }))
        })
        const name = topics.find((topic) => topic.id === topicId)?.name ?? 'the topic'
        const added = result.promptIds.length
        const skipped = result.skipped.length
        say(
          added === 0
            ? `${name} already tracks ${skipped === 1 ? 'this question' : 'these questions'}.`
            : `Added ${pluralize(added, 'question')} to ${name}${skipped > 0 ? ` · ${skipped} already tracked` : ''}. They are searched from the next check.`
        )
      } catch (cause) {
        say(errorText(cause, 'Could not add the questions to the topic.'), true)
      } finally {
        setAdding(false)
      }
    },
    [source, projectId, topics, say]
  )

  const addToNewTopic = useCallback(
    (gaps: readonly CompetitorGapQuestion[]): void => {
      openDrawer(
        'new-topic',
        {},
        {
          onResult: (topicId) => {
            if (typeof topicId !== 'string') return
            setReloads((value) => value + 1)
            void addToTopic(topicId, gaps)
          }
        }
      )
    },
    [addToTopic]
  )

  const logFix = useCallback((gaps: readonly CompetitorGapQuestion[]): void => {
    const page = busiestPage(gaps)
    if (page === null) return
    const prompts = [
      ...new Set(gaps.filter((gap) => gap.pageId === page).map((gap) => gap.promptId))
    ]
    openDrawer('fix', { fix: 'new', 'fix.page': page, 'fix.prompts': prompts.join(',') })
  }, [])

  const setKind = useCallback(
    async (row: CitedSiteRow, kind: SortableSiteKind): Promise<void> => {
      if (row.domain === null) return
      setSorting(true)
      say(null)
      try {
        await source['competitors:setSiteKind']({ projectId, domain: row.domain, kind })
        onChanged()
      } catch (cause) {
        say(errorText(cause, 'Could not save the kind of site.'), true)
      } finally {
        setSorting(false)
      }
    },
    [source, projectId, onChanged, say]
  )

  return { topics, adding, sorting, message, error, addToTopic, addToNewTopic, logFix, setKind }
}

/** The page or topic with the most of these questions (the first one on a tie). */
export function busiestPage(gaps: readonly CompetitorGapQuestion[]): string | null {
  const counts = new Map<string, number>()
  for (const gap of gaps) counts.set(gap.pageId, (counts.get(gap.pageId) ?? 0) + 1)
  let best: string | null = null
  for (const [page, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = page
  }
  return best
}
