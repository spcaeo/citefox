import { useEffect, useMemo, useState, type JSX } from 'react'
import type { QuestionRef, QuestionTarget } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { openDrawer } from '../shell/drawers'
import { NOT_IN_TOPIC_LABEL } from '../topics/clusters'
import {
  Button,
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SectionMenu,
  SegmentedControl
} from '../ui'
import { BACK_TO_PAGE, count, destinations, type Load } from './moveModel'
import type { MoveMode } from './open'
import { copyQuestions, moveQuestions } from './ops'
import type { QuestionEditSource } from './source'
import './questionEdit.css'

/**
 * Move questions to another topic (or back to their pages), or copy them into
 * any page or topic (`?drawer=move-questions&mq.ids=<src~prompt,…>&mq.mode=`).
 * Both act at once and the toast offers Undo. "+ New topic…" and "+ Track a new
 * page…" open their drawers on top and come back picked.
 */
export function MoveQuestionsDrawer({
  source,
  projectId,
  refs,
  mode,
  depth,
  onMode,
  onClose,
  onDone
}: {
  source: QuestionEditSource
  projectId: string
  refs: readonly QuestionRef[]
  mode: MoveMode
  /** The drawer's stack depth: "+ New …" stacks only over a drawer of its own. */
  depth: number
  onMode: (mode: MoveMode) => void
  onClose: () => void
  /** After a move or copy: close this drawer (and the one it came from, when stale). */
  onDone: () => void
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [choice, setChoice] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const key = refs.map((ref) => `${ref.sourceId}~${ref.promptId}`).join(',')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      source['questions:list']({ projectId }),
      source['prompts:addTargets']({ projectId })
    ]).then(
      ([list, targets]) => {
        if (cancelled) return
        setLoad({
          status: 'ready',
          data: {
            rows: list.rows,
            topicIds: new Set(
              list.sources.filter((item) => item.kind === 'topic').map((item) => item.id)
            ),
            sourceNames: new Map(list.sources.map((item) => [item.id, item.name])),
            targets: targets.targets
          }
        })
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoad({ status: 'error', message: errorText(cause, 'Could not load the questions.') })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt])

  const data = load.status === 'ready' ? load.data : null
  const picked = useMemo(() => {
    if (!data) return []
    const wanted = new Set(key.split(','))
    return data.rows.filter((row) => wanted.has(`${row.sourceId}~${row.promptId}`))
  }, [data, key])
  const options = data ? destinations(data, picked, mode) : null
  const chosen =
    choice === BACK_TO_PAGE
      ? { id: BACK_TO_PAGE, name: NOT_IN_TOPIC_LABEL }
      : (data?.targets.find((target) => target.id === choice) ?? null)
  const valid =
    chosen !== null &&
    (choice === BACK_TO_PAGE
      ? options?.backToPage === true
      : [...(options?.topics ?? []), ...(options?.pages ?? [])].some((item) => item.id === choice))
  const missing = data ? refs.length - picked.length : 0

  async function run(): Promise<void> {
    if (!chosen || !valid || picked.length === 0 || !data) return
    setBusy(true)
    const done =
      mode === 'copy'
        ? await copyQuestions(
            source,
            projectId,
            picked.map((row) => ({ text: row.text })),
            { id: chosen.id, name: chosen.name }
          )
        : await moveQuestions(
            source,
            projectId,
            picked.map((row) => ({
              sourceId: row.sourceId,
              promptId: row.promptId,
              fromTopicId: data.topicIds.has(row.sourceId) ? row.sourceId : null
            })),
            choice === BACK_TO_PAGE ? { kind: 'page' } : { kind: 'topic', topicId: chosen.id }
          )
    setBusy(false)
    if (done !== null) onDone()
  }

  function newTopic(): void {
    if (mode === 'move') {
      // The new-topic drawer moves the questions itself when it creates the topic.
      openDrawer(
        'new-topic',
        { questions: picked.map((row) => row.promptId).join(',') },
        { onResult: () => onDone() }
      )
      return
    }
    openDrawer('new-topic', {}, { onResult: (id) => afterCreate(id) })
  }

  function afterCreate(id: unknown): void {
    if (typeof id !== 'string') return
    setChoice(id)
    setAttempt((n) => n + 1)
  }

  const verb = mode === 'copy' ? 'Copy' : 'Move'
  const what = count(picked.length)
  const canStack = depth === 0

  function option(target: QuestionTarget): JSX.Element {
    const questions = count(target.questions)
    return (
      <li key={target.id}>
        <label className="qe-dest">
          <input
            type="radio"
            name="qe-destination"
            value={target.id}
            checked={choice === target.id}
            disabled={busy}
            onChange={() => setChoice(target.id)}
          />
          <span className="qe-dest-name">{target.name}</span>
          <span className="qe-dest-meta">
            {target.status === 'paused' ? `Paused · ${questions}` : questions}
          </span>
        </label>
      </li>
    )
  }

  return (
    <Drawer
      id="move-questions"
      title={mode === 'copy' ? 'Duplicate questions' : 'Move questions'}
      subtitle={
        mode === 'copy'
          ? 'Copies stay where they are and start fresh in the page or topic you pick.'
          : 'A question sits in one topic, or on the page it was set up on. Its past results move with it.'
      }
      headerExtra={
        <SegmentedControl<MoveMode>
          label="Move or duplicate"
          size="sm"
          value={mode}
          onChange={(next) => {
            setChoice('')
            onMode(next)
          }}
          options={[
            { value: 'move', label: 'Move' },
            { value: 'copy', label: 'Duplicate' }
          ]}
        />
      }
      loading={load.status === 'loading'}
      error={
        load.status === 'error'
          ? {
              message: load.message,
              onRetry: () => {
                setLoad({ status: 'loading' })
                setAttempt((n) => n + 1)
              }
            }
          : undefined
      }
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      testId="move-questions-drawer"
      footer={{
        summary: !chosen
          ? `${what} picked · pick where they go`
          : `${verb === 'Copy' ? 'Copies' : 'Moves'} ${what} to ${chosen.name} · saved at once · nothing is searched · Undo for 10 s`,
        primary: {
          label: `${verb} ${what}`,
          busy,
          disabled: !valid || picked.length === 0,
          onClick: () => void run()
        }
      }}
    >
      {data && options ? (
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title={mode === 'copy' ? 'Duplicate into' : 'Move to'}
              description={
                mode === 'copy'
                  ? 'Any page or topic. A question already there is left out.'
                  : 'A topic, or back to the page each question targets.'
              }
              actions={
                !canStack ? undefined : mode === 'copy' ? (
                  <SectionMenu
                    label="Add a destination"
                    items={[
                      {
                        id: 'new-topic',
                        label: 'New topic…',
                        icon: 'plus',
                        disabled: busy,
                        onSelect: newTopic
                      },
                      {
                        id: 'track-page',
                        label: 'Track a new page…',
                        icon: 'plus',
                        disabled: busy,
                        onSelect: () =>
                          openDrawer('track-page', {}, { onResult: (id) => afterCreate(id) })
                      }
                    ]}
                  />
                ) : (
                  <Button size="sm" variant="text" icon="plus" disabled={busy} onClick={newTopic}>
                    New topic…
                  </Button>
                )
              }
            >
              <div role="radiogroup" aria-label={mode === 'copy' ? 'Duplicate into' : 'Move to'}>
                {options.topics.length > 0 ? (
                  <>
                    <p className="qe-dest-head">Topics</p>
                    <ul className="qe-dest-list">{options.topics.map(option)}</ul>
                  </>
                ) : null}
                {options.backToPage ? (
                  <ul className="qe-dest-list">
                    <li>
                      <label className="qe-dest">
                        <input
                          type="radio"
                          name="qe-destination"
                          value={BACK_TO_PAGE}
                          checked={choice === BACK_TO_PAGE}
                          disabled={busy}
                          onChange={() => setChoice(BACK_TO_PAGE)}
                        />
                        <span className="qe-dest-name">{NOT_IN_TOPIC_LABEL}</span>
                        <span className="qe-dest-meta">Back to its page</span>
                      </label>
                    </li>
                  </ul>
                ) : null}
                {options.pages.length > 0 ? (
                  <>
                    <p className="qe-dest-head">Pages</p>
                    <ul className="qe-dest-list">{options.pages.map(option)}</ul>
                  </>
                ) : null}
                {options.topics.length === 0 &&
                options.pages.length === 0 &&
                !options.backToPage ? (
                  <p className="faint">No other topic yet. Make one with New topic.</p>
                ) : null}
              </div>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="The questions">
            <DrawerSection title="Questions" count={picked.length}>
              {missing > 0 ? (
                <p className="qe-warning">
                  {count(missing)} changed since this link was made and{' '}
                  {missing === 1 ? 'is' : 'are'} left out.
                </p>
              ) : null}
              <ul className="qe-picked">
                {picked.slice(0, 12).map((row) => (
                  <li key={`${row.sourceId}~${row.promptId}`}>
                    <span>{row.text}</span>
                    <span className="qe-picked-from">
                      From {data.sourceNames.get(row.sourceId) ?? 'a page'}
                    </span>
                  </li>
                ))}
              </ul>
              {picked.length > 12 ? (
                <p className="faint">and {count(picked.length - 12, 'more', 'more')}</p>
              ) : null}
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}
