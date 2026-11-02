import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { QuestionRow, SortQuestionsResult } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { ScreenDrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer } from '../../shell/drawers'
import { refsOf } from '../../topics/clusters'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../ui'
import type { TopicChoice } from '../grouping'
import type { MoveBatch } from '../hooks/useClusterActions'
import { countText } from '../model'
import type { QuestionsSource } from '../source'
import { SORT_MAX, firstChoice, sortBatches, type SortChoice } from '../utils/sortProposals'

/** The select value that opens the New topic drawer. Never a real choice. */
const CREATE_TOPIC = '__create__'

type Run =
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: SortQuestionsResult }

/**
 * "Sort into topics" (`?panel=sort`), a drawer: Claude proposes a topic for each
 * question in "Not in a topic" (the first 100), one of the project's topics or a new
 * one, with a reason. Each proposal is ticked with its topic picked; the owner can
 * untick or pick another, then "Move N questions" moves them, one call per
 * destination. The rail shows how many go where. No searches are run.
 */
export function SortDrawer({
  rows,
  topics,
  source,
  projectId,
  busy,
  onClose,
  onApply
}: {
  /** The questions in "Not in a topic". */
  rows: readonly QuestionRow[]
  topics: readonly TopicChoice[]
  source: QuestionsSource
  projectId: string
  busy: boolean
  onClose: () => void
  onApply: (batches: readonly MoveBatch[]) => void
}): JSX.Element {
  const items = useMemo(() => refsOf(rows.slice(0, SORT_MAX)), [rows])
  const [run, setRun] = useState<Run>({ status: 'running' })
  const [choices, setChoices] = useState<SortChoice[]>([])
  const [touched, setTouched] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  /** The attempt already sent, so a re-render (or Strict Mode) does not call Claude twice. */
  const sent = useRef(-1)
  // The list reloads after each move; the call is for the questions the drawer opened with.
  const itemsRef = useRef(items)

  const start = useCallback(async (): Promise<void> => {
    const chosen = itemsRef.current
    if (chosen.length === 0) {
      setRun({ status: 'error', message: 'Every question is in a topic already.' })
      return
    }
    setRun({ status: 'running' })
    try {
      const result = await source['topics:sortQuestions']({ projectId, items: chosen })
      if (!mounted.current) return
      setChoices(result.proposals.map(firstChoice))
      setTouched(false)
      setRun({ status: 'done', result })
    } catch (cause) {
      if (!mounted.current) return
      setRun({
        status: 'error',
        message: errorText(cause, 'CiteFox AI could not sort these questions.', { sentence: true })
      })
    }
  }, [source, projectId])

  useEffect(() => {
    mounted.current = true
    if (sent.current !== attempt) {
      sent.current = attempt
      void start()
    }
    return () => {
      mounted.current = false
    }
  }, [attempt, start])

  const proposals = run.status === 'done' ? run.result.proposals : []
  const newNames = [
    ...new Set(
      proposals.flatMap((proposal) =>
        proposal.newTopic !== null && proposal.newTopic.trim() !== ''
          ? [proposal.newTopic.trim()]
          : []
      )
    )
  ]
  const batches = sortBatches(proposals, choices)
  const moving = batches.reduce((sum, batch) => sum + batch.rows.length, 0)
  const setChoice = (index: number, patch: Partial<SortChoice>): void => {
    setTouched(true)
    setChoices((current) =>
      current.map((choice, at) => (at === index ? { ...choice, ...patch } : choice))
    )
  }
  const destinationName = (batch: MoveBatch): string => {
    const to = batch.to
    if (to.kind === 'topic') {
      return topics.find((topic) => topic.id === to.topicId)?.name ?? 'A topic'
    }
    return to.kind === 'new' ? `New: ${to.name}` : 'Not in a topic'
  }

  return (
    <ScreenDrawerLevel onClose={onClose}>
      <Drawer
        id="sort-questions"
        title="Sort into topics"
        subtitle={`Not in a topic · CiteFox AI proposes a topic for each of ${countText(items.length, 'question')}. No new searches.`}
        dirty={touched && moving > 0}
        busy={busy}
        closeDisabled={busy}
        onClose={onClose}
        testId="sort-drawer"
        footer={{
          summary:
            run.status === 'done' ? (
              <>
                <strong className="num">{countText(moving, 'question')}</strong> to move ·{' '}
                {countText(batches.length, 'topic')} · No new searches
              </>
            ) : run.status === 'running' ? (
              'CiteFox AI is sorting · No new searches'
            ) : (
              'No proposals yet'
            ),
          ...(run.status === 'done'
            ? {
                secondary: {
                  label: 'Ask again',
                  icon: 'sparkle' as const,
                  disabled: busy,
                  onClick: () => setAttempt((n) => n + 1)
                }
              }
            : {}),
          primary: {
            label: `Move ${countText(moving, 'question')}`,
            disabled: run.status !== 'done' || moving === 0,
            busy,
            onClick: () => onApply(batches)
          }
        }}
      >
        <DrawerGrid className="qs-drawer">
          <DrawerMain>
            <DrawerSection
              title="Proposals"
              {...(run.status === 'done' ? { count: proposals.length } : {})}
              description={
                run.status === 'done'
                  ? `${run.result.info.label.text}. Untick a question to leave it where it is.`
                  : rows.length > SORT_MAX
                    ? `Sorting the first ${SORT_MAX} of ${countText(rows.length, 'question')}. Sort again for the rest.`
                    : 'Each question gets one of your topics or a new one, with a reason.'
              }
              loading={run.status === 'running'}
              error={run.status === 'error' ? run.message : null}
              {...(run.status === 'error' && items.length > 0
                ? { onRetry: () => setAttempt((n) => n + 1) }
                : {})}
            >
              {run.status === 'running' ? (
                <p className="qs-panel-status" role="status">
                  CiteFox AI · sorting {countText(items.length, 'question')} · No new searches
                </p>
              ) : null}
              {run.status === 'done' ? (
                <>
                  {run.result.info.notice ? (
                    <p className="faint">{run.result.info.notice}</p>
                  ) : null}
                  <ul className="qs-proposals" aria-label="Proposals">
                    {proposals.map((proposal, index) => {
                      const choice = choices[index] ?? { ticked: false, value: '' }
                      return (
                        <li key={proposal.promptId} className="qs-proposal">
                          <input
                            type="checkbox"
                            className="ui-check"
                            checked={choice.ticked}
                            disabled={choice.value === ''}
                            aria-label={`Move “${proposal.text}”`}
                            onChange={(event) => setChoice(index, { ticked: event.target.checked })}
                          />
                          <div className="qs-proposal-body">
                            <p className="qs-proposal-text">{proposal.text}</p>
                            {proposal.reason ? <p className="faint">{proposal.reason}</p> : null}
                          </div>
                          <select
                            className="select qs-select"
                            aria-label={`Topic for “${proposal.text}”`}
                            value={choice.value}
                            onChange={(event) => {
                              const value = event.target.value
                              if (value === CREATE_TOPIC) {
                                // The new topic comes back picked for this question.
                                openDrawer(
                                  'new-topic',
                                  {},
                                  {
                                    onResult: (id) => {
                                      if (typeof id === 'string') {
                                        setChoice(index, { value: `topic:${id}`, ticked: true })
                                      }
                                    }
                                  }
                                )
                                return
                              }
                              setChoice(index, { value, ticked: value !== '' })
                            }}
                          >
                            <option value="">Pick a topic</option>
                            {topics.map((topic) => (
                              <option key={topic.id} value={`topic:${topic.id}`}>
                                {topic.name}
                              </option>
                            ))}
                            {newNames.map((name) => (
                              <option key={name} value={`new:${name}`}>
                                New: {name}
                              </option>
                            ))}
                            <option value={CREATE_TOPIC}>+ New topic…</option>
                          </select>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="Where they go">
            <DrawerSection
              title="Where they go"
              description="Each topic gets one move. Questions keep their checks."
              loading={run.status === 'running'}
            >
              {run.status === 'done' && batches.length > 0 ? (
                <ul className="qs-dest" aria-label="Where they go">
                  {batches.map((batch) => (
                    <li key={destinationName(batch)} className="qs-dest-row">
                      <span className="qs-dest-name">{destinationName(batch)}</span>
                      <span className="num">{batch.rows.length}</span>
                    </li>
                  ))}
                </ul>
              ) : run.status === 'done' ? (
                <p className="faint">Nothing ticked yet.</p>
              ) : null}
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      </Drawer>
    </ScreenDrawerLevel>
  )
}
