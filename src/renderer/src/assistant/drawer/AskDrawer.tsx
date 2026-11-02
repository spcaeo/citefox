import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { ASSISTANT_QUESTION_MAX } from '@shared/ipc'
import {
  Button,
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  LinkButton,
  UiIcon
} from '../../ui'
import { createAssistantClient, type AssistantClient } from '../client'
import type { AiEntityRef } from '../context/types'
import { useCurrentAiContext } from '../context/useAiContext'
import { clearPendingAsk, peekPendingAsk } from '../openAsk'
import { toAssistantContext } from '../request'
import { helpQuestionsFor } from '../helpQuestions'
import { helpDrawerReady, helpTitle, openHelp } from '../openHelp'
import { suggestionsFor } from '../suggestions'
import { useAssistantThread, type Thread } from '../thread'
import { ASSISTANT_COPY, contextChips } from '../words'
import { aboutEntity, CONNECTIONS_HREF, useClaudeGate, type ClaudeGate } from './model'
import { TurnCard } from './TurnCard'
import '../../m3/m3.css'
import './ask-drawer.css'

/**
 * Ask CiteFox (deep audit crosscut §3.3): the 80% drawer over any screen.
 * It reads what the screen registered (`useAiContext`), offers questions for
 * this screen, and answers from stored checks only. Actions in an answer run
 * only after a click. The conversation stays for the session; "New chat"
 * clears it.
 */
export function AskDrawer({
  projectId,
  question,
  about,
  depth,
  onClose,
  client: given
}: {
  /** Null with no project open: app-level questions and setup help. */
  projectId: string | null
  /** `ask.q` on the URL. */
  question: string | null
  /** `ask.about` on the URL. */
  about: string | null
  depth: number
  onClose: () => void
  client?: AssistantClient
}): JSX.Element {
  const client = useMemo(() => given ?? createAssistantClient(), [given])
  const context = useCurrentAiContext()
  const gate = useClaudeGate()
  const thread = useAssistantThread(client, projectId)

  return (
    <Drawer
      id="ask"
      title={ASSISTANT_COPY.title}
      subtitle={`About ${context.screenLabel} · ${projectId === null ? ASSISTANT_COPY.noProjectSubtitle : 'answers from your stored checks'}`}
      depth={depth}
      onClose={onClose}
      busy={thread.asking}
      testId="ask-drawer"
      footer={{
        summary: <span className="asst-footer">{ASSISTANT_COPY.footer}</span>,
        cancel: 'Close',
        secondary:
          thread.turns.length > 0
            ? {
                label: ASSISTANT_COPY.newChat,
                icon: 'plus',
                onClick: thread.clear,
                disabled: thread.asking
              }
            : undefined
      }}
    >
      {/* A new question or subject on the URL (another ✦ pick) starts the box afresh. */}
      <AskBody
        key={`${question ?? ''}|${about ?? ''}`}
        projectId={projectId}
        question={question}
        about={about}
        client={client}
        thread={thread}
        gate={gate}
      />
    </Drawer>
  )
}

function AskBody({
  projectId,
  question,
  about,
  client,
  thread,
  gate
}: {
  projectId: string | null
  question: string | null
  about: string | null
  client: AssistantClient
  thread: Thread
  gate: ClaudeGate
}): JSX.Element {
  const { readiness } = gate
  const context = useCurrentAiContext()
  // A ✦ pick sends its question; a pasted link only fills the box.
  const [initial] = useState(() => {
    const pending = peekPendingAsk(question)
    return {
      send: pending?.send === true,
      question: pending?.question ?? question ?? '',
      about: pending?.about ?? null
    }
  })
  const [typed, setTyped] = useState<string | null>(null)
  const [picked, setPicked] = useState<AiEntityRef | null | undefined>(undefined)
  const [gating, setGating] = useState(false)
  const inputId = useId()
  const listRef = useRef<HTMLOListElement | null>(null)
  const sent = useRef(false)
  const { ask, turns, asking } = thread

  const focus = picked === undefined ? (initial.about ?? aboutEntity(about, context)) : picked
  const draft = typed ?? (initial.send && readiness !== 'not-ready' ? '' : initial.question)
  const suggestions = useMemo(() => suggestionsFor(context), [context])
  const chips = useMemo(() => contextChips(context), [context])

  useEffect(() => clearPendingAsk(), [])

  // The picked question waits for the Claude status, then goes once; never when Claude is not ready.
  useEffect(() => {
    if (sent.current || !initial.send || readiness === 'checking') return
    sent.current = true
    if (readiness === 'not-ready') return
    const request = toAssistantContext(context, focus)
    if (readiness === 'ready') {
      void ask(initial.question, request)
      return
    }
    void gate.ensure().then((ok) => {
      if (ok) void ask(initial.question, request)
    })
  }, [initial, readiness, ask, context, focus, gate])

  const turnCount = turns.length
  useEffect(() => {
    const last = listRef.current?.lastElementChild
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' })
  }, [turnCount])

  const notReady = readiness === 'not-ready'
  const blocked = notReady || readiness === 'checking' || gating

  async function send(text: string): Promise<void> {
    const trimmed = text.trim().slice(0, ASSISTANT_QUESTION_MAX)
    if (trimmed === '' || asking || blocked) return
    const request = toAssistantContext(context, focus)
    setTyped('')
    if (readiness === 'unchecked') {
      // A click checks Claude Code first, as every AI step does.
      setGating(true)
      const ok = await gate.ensure()
      setGating(false)
      if (!ok) {
        setTyped(trimmed)
        return
      }
    }
    void ask(trimmed, request)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void send(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(draft)
    }
  }

  return (
    <DrawerGrid className="asst-grid-layout">
      <DrawerMain>
        <DrawerSection tone="plain" className="asst-chat">
          {notReady ? (
            // One notice and one button (Vibe AttentionBox): nothing here can work yet.
            <div className="asst-notready" role="status" data-testid="asst-claude-not-ready">
              <p>{ASSISTANT_COPY.claudeNotReady}</p>
              <LinkButton size="sm" variant="primary" icon="sparkle" href={CONNECTIONS_HREF}>
                Connect CiteFox AI
              </LinkButton>
            </div>
          ) : null}
          {notReady && turnCount === 0 ? null : turnCount === 0 ? (
            <>
              <p className="asst-empty" data-testid="asst-empty">
                {projectId === null ? (
                  ASSISTANT_COPY.noProject
                ) : (
                  <>
                    Ask about what you see on {context.screenLabel}, or pick a suggestion. Answers
                    use only this project&apos;s saved checks.
                  </>
                )}
              </p>
              <StartHelp
                screen={context.screen}
                projectId={projectId}
                skip={suggestions}
                disabled={asking}
                onAsk={(item) => (blocked ? setTyped(item) : void send(item))}
              />
            </>
          ) : (
            <ol className="asst-turns" ref={listRef} aria-label="Conversation">
              {turns.map((turn) => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  projectId={projectId}
                  client={client}
                  onRetry={() => void send(turn.question)}
                />
              ))}
            </ol>
          )}
          {notReady ? null : (
            <form className="asst-compose" onSubmit={onSubmit} aria-label="Ask a question">
              {focus ? (
                <p className="asst-about">
                  About: <strong>{focus.label}</strong>
                  <button
                    type="button"
                    className="asst-about-clear"
                    aria-label={`Stop asking about ${focus.label}`}
                    onClick={() => setPicked(null)}
                  >
                    ×
                  </button>
                </p>
              ) : null}
              <label className="sr-only" htmlFor={inputId}>
                {ASSISTANT_COPY.inputLabel}
              </label>
              <textarea
                id={inputId}
                className="asst-input"
                data-autofocus
                rows={2}
                maxLength={ASSISTANT_QUESTION_MAX}
                placeholder={ASSISTANT_COPY.placeholder}
                value={draft}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <div className="asst-compose-row">
                <span className="asst-compose-hint">
                  {readiness === 'checking' || gating
                    ? ASSISTANT_COPY.claudeChecking
                    : readiness === 'unchecked'
                      ? 'CiteFox checks the AI before the first answer · Enter to ask'
                      : 'Enter to ask · Shift Enter for a new line'}
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  icon="sparkle"
                  busy={asking || gating}
                  disabled={blocked || draft.trim() === ''}
                >
                  Ask
                </Button>
              </div>
            </form>
          )}
        </DrawerSection>
      </DrawerMain>
      <DrawerRail label="What Ask CiteFox reads">
        <DrawerSection title={ASSISTANT_COPY.lookingAt} testId="asst-looking-at">
          <ul className="asst-chips">
            {chips.map((chip) => (
              <li key={chip} className="asst-chip" title={chip}>
                {chip}
              </li>
            ))}
          </ul>
        </DrawerSection>
        {notReady ? null : (
          <DrawerSection title={ASSISTANT_COPY.suggested} testId="asst-suggested">
            <ul className="asst-suggestions">
              {suggestions.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="asst-suggestion"
                    disabled={asking}
                    onClick={() => (blocked ? setTyped(item) : void send(item))}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}
      </DrawerRail>
    </DrawerGrid>
  )
}

/**
 * The empty drawer's how / why questions for this screen (answered from the
 * help docs and the project's own facts) and a link to the screen's help topic.
 * Questions the rail already offers are left out.
 */
function StartHelp({
  screen,
  projectId,
  skip,
  disabled,
  onAsk
}: {
  screen: string
  projectId: string | null
  skip: readonly string[]
  disabled: boolean
  onAsk: (question: string) => void
}): JSX.Element | null {
  const { topicId, questions } = helpQuestionsFor({ screen, projectId })
  const shown = questions.filter((item) => !skip.includes(item))
  const ready = helpDrawerReady()
  if (shown.length === 0 && !ready) return null
  return (
    <div className="asst-start" data-testid="asst-start">
      {shown.length > 0 ? (
        <>
          <h4 className="asst-block-title">Common questions here</h4>
          <ul className="asst-start-list">
            {shown.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="asst-suggestion"
                  disabled={disabled}
                  onClick={() => onAsk(item)}
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {ready ? (
        <p className="asst-start-topic">
          <UiIcon name="book-open" size={14} />
          <button type="button" className="asst-link" onClick={() => openHelp(topicId)}>
            Help for this screen: {helpTitle(topicId)}
          </button>
        </p>
      ) : null}
    </div>
  )
}
