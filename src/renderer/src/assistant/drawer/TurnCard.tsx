import type { JSX } from 'react'
import type { AssistantAnswer, AssistantSource } from '@shared/ipc'
import { AskCounts, AskResults } from '../results/AskResults'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { openDrawer } from '../../shell/drawers'
import { Button, UiIcon } from '../../ui'
import type { AssistantClient } from '../client'
import type { Turn } from '../thread'
import { helpDrawerReady, helpTitle, nextStepHref, openHelp } from '../openHelp'
import { ASSISTANT_COPY, basedOnText, sourceHref } from '../words'
import { ActionCard } from './ActionCard'
import { CopyDraft } from './CopyDraft'

/** One question and its answer in the conversation. */
export function TurnCard({
  turn,
  projectId,
  client,
  onRetry
}: {
  turn: Turn
  projectId: string | null
  client: AssistantClient
  onRetry: () => void
}): JSX.Element {
  return (
    <li className="asst-turn" data-status={turn.status}>
      <div className="asst-q">
        <p className="asst-q-where">You asked on {turn.where}</p>
        <p className="asst-q-text">{turn.question}</p>
      </div>
      {turn.status === 'asking' ? (
        <p className="asst-wait" role="status">
          <UiIcon name="sparkle" size={14} />
          Reading your saved checks…
        </p>
      ) : turn.status === 'error' ? (
        <TurnError error={turn.error ?? ''} projectId={projectId} onRetry={onRetry} />
      ) : turn.answer ? (
        <AnswerBody answer={turn.answer} turnId={turn.id} projectId={projectId} client={client} />
      ) : null}
    </li>
  )
}

/** The error, and Try again; while Claude Code waits out a usage limit, when it is back. */
function TurnError({
  error,
  projectId,
  onRetry
}: {
  error: string
  projectId: string | null
  onRetry: () => void
}): JSX.Element {
  const pause = useClaudePause(true, projectId)
  return (
    <div className="asst-error" role="alert">
      <p>
        <LinkedText text={error} />
      </p>
      {pause ? (
        <ClaudeWait pause={pause} />
      ) : (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

function AnswerBody({
  answer,
  turnId,
  projectId,
  client
}: {
  answer: AssistantAnswer
  turnId: string
  projectId: string | null
  client: AssistantClient
}): JSX.Element {
  const paragraphs = answer.text.split(/\n{2,}|\n/).filter((line) => line.trim() !== '')
  return (
    <section
      className="asst-answer"
      aria-label="Answer from CiteFox AI"
      data-intent={answer.intent}
    >
      {paragraphs.map((line, index) => (
        <p key={index} className="asst-answer-text">
          {line}
        </p>
      ))}
      <HelpLinks answer={answer} />
      {answer.flagged.length > 0 ? (
        <p className="asst-flagged" data-testid="asst-flagged">
          <UiIcon name="warning" size={14} />
          {ASSISTANT_COPY.flagged(answer.flagged.length)}
        </p>
      ) : null}
      {answer.list ? (
        <div className="asst-list">
          <AskCounts rows={answer.list.rows} total={answer.list.total} projectId={projectId} />
          <AskResults rows={answer.list.rows} total={answer.list.total} projectId={projectId} />
        </div>
      ) : null}
      {answer.draft ? <CopyDraft text={answer.draft} label="Draft" /> : null}
      {answer.questions.length > 0 ? (
        <div className="asst-block">
          <h4 className="asst-block-title">Questions to consider</h4>
          <ol className="asst-questions">
            {answer.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {answer.sources.length > 0 ? (
        <div className="asst-block">
          <h4 className="asst-block-title">From your saved data</h4>
          <ul className="asst-sources">
            {answer.sources.map((source, index) => (
              <li key={`${source.kind}:${index}`}>
                <SourceLink source={source} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.unknowns.length > 0 ? (
        <div className="asst-block">
          <h4 className="asst-block-title">{ASSISTANT_COPY.notInData}</h4>
          <ul className="asst-unknowns">
            {answer.unknowns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.actions.length > 0 && projectId !== null ? (
        <div className="asst-actions">
          {answer.actions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              projectId={projectId}
              client={client}
              memoryKey={`${turnId}:${action.id}`}
            />
          ))}
        </div>
      ) : null}
      <p className="asst-meta">{basedOnText(answer)}</p>
    </section>
  )
}

function SourceLink({ source }: { source: AssistantSource }): JSX.Element {
  if (source.kind === 'drill' && source.drill) {
    const drill = source.drill
    return (
      <button type="button" className="asst-link" onClick={() => openDrawer('drill', { drill })}>
        {source.label}
      </button>
    )
  }
  const href = sourceHref(source)
  return href ? (
    <a className="asst-link" href={href}>
      {source.label}
    </a>
  ) : (
    <span>{source.label}</span>
  )
}

/**
 * The help topics the answer used ("Read more: Check history", opening the
 * help drawer) and one next step to the screen the topic is about.
 */
function HelpLinks({ answer }: { answer: AssistantAnswer }): JSX.Element | null {
  const help = answer.help ?? []
  const next = answer.next ?? null
  const href = next ? nextStepHref(next.section) : null
  if (help.length === 0 && href === null) return null
  const ready = helpDrawerReady()
  return (
    <ul className="asst-help" data-testid="asst-help" aria-label="Help for this answer">
      {help.map((link) => {
        const title = helpTitle(link.id, link.title)
        return (
          <li key={link.id}>
            <UiIcon name="book-open" size={14} />
            {ready ? (
              <button type="button" className="asst-link" onClick={() => openHelp(link.id)}>
                Read more: {title}
              </button>
            ) : (
              <span>From help: {title}</span>
            )}
          </li>
        )
      })}
      {next && href !== null ? (
        <li>
          <UiIcon name="arrow-right" size={14} />
          <a className="asst-link" href={href} data-testid="asst-next">
            {next.label}
          </a>
        </li>
      ) : null}
    </ul>
  )
}
