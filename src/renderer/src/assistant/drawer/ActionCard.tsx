import { useState, type JSX } from 'react'
import type { AssistantAction } from '@shared/ipc'
import { Button } from '../../ui'
import type { AssistantClient } from '../client'
import { actionCost, actionVerb, runAssistantAction, type ActionOutcome } from '../runAction'
import { settleCard, settledCard } from '../thread'
import { askErrorText } from '../words'
import { useCheckCost } from './checkCost'
import { CopyDraft } from './CopyDraft'

type CardState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; outcome: ActionOutcome }
  | { kind: 'skipped' }
  | { kind: 'failed'; message: string }

/**
 * One thing the answer offers to do. Nothing runs until the user clicks its
 * button: the card says what will change and what it costs first, and
 * "Not now" puts it away.
 */
export function ActionCard({
  action,
  projectId,
  client,
  memoryKey,
  run = runAssistantAction
}: {
  action: AssistantAction
  projectId: string
  client: AssistantClient
  /** Keeps the card done or put away for the session (turn id and action id). */
  memoryKey?: string
  /** Tests only. */
  run?: typeof runAssistantAction
}): JSX.Element {
  const [state, setState] = useState<CardState>(() => settledCard(memoryKey) ?? { kind: 'idle' })
  // A check shows what it costs and what is left, as the Check now drawer does.
  const cost = useCheckCost(action, projectId, client)
  const tooMany = cost?.tooMany === true

  async function confirm(): Promise<void> {
    setState({ kind: 'running' })
    try {
      const outcome = await run(client, projectId, action)
      settleCard(memoryKey, { kind: 'done', outcome })
      setState({ kind: 'done', outcome })
    } catch (failure) {
      setState({ kind: 'failed', message: askErrorText(failure) })
    }
  }

  return (
    <article
      className="asst-action"
      data-state={state.kind}
      data-action={action.kind}
      aria-label={`Suggested action: ${action.title}`}
    >
      <p className="asst-action-kicker">Suggested action · needs your OK</p>
      <h4 className="asst-action-title">{action.title}</h4>
      {action.detail ? <p className="asst-action-detail">{action.detail}</p> : null}
      {action.questions.length > 0 ? (
        <ul className="asst-action-list">
          {action.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      ) : null}
      {state.kind === 'idle' || state.kind === 'running' || state.kind === 'failed' ? (
        <>
          <p className="asst-action-cost" data-testid="asst-action-cost">
            {cost ? `Uses ${lowerFirst(cost.line)}` : actionCost(action)}
          </p>
          {tooMany ? (
            <p className="asst-action-error" role="alert">
              Not enough searches left this month for this check.
            </p>
          ) : null}
          {state.kind === 'failed' ? (
            <p className="asst-action-error" role="alert">
              {state.message}
            </p>
          ) : null}
          <div className="asst-action-buttons">
            <Button
              size="sm"
              variant="secondary"
              icon="check"
              busy={state.kind === 'running'}
              disabled={tooMany}
              onClick={() => void confirm()}
            >
              {state.kind === 'failed' ? 'Try again' : actionVerb(action)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.kind === 'running'}
              onClick={() => {
                settleCard(memoryKey, { kind: 'skipped' })
                setState({ kind: 'skipped' })
              }}
            >
              Not now
            </Button>
          </div>
        </>
      ) : state.kind === 'skipped' ? (
        <p className="asst-action-status" role="status">
          Skipped. Nothing changed.
        </p>
      ) : (
        <div className="asst-action-done" role="status">
          <p>{state.outcome.text}</p>
          {state.outcome.draft ? (
            <CopyDraft text={state.outcome.draft} label="Drafted fix" />
          ) : null}
          {state.outcome.href ? (
            <a className="asst-link" href={state.outcome.href}>
              {state.outcome.hrefLabel ?? 'Open'}
            </a>
          ) : null}
        </div>
      )}
    </article>
  )
}

/** "about 2–4 searches · 210 left this month" after "Uses". */
function lowerFirst(text: string): string {
  return text.length > 0 ? `${text[0]?.toLowerCase() ?? ''}${text.slice(1)}` : text
}
