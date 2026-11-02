import { useEffect, useId, useState, type JSX } from 'react'
import type { CommunityThread } from '@shared/domain'
import { ASSIST_INSTRUCTION_MAX, type AssistResult } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { INSTRUCTION_PLACEHOLDER, NO_NEW_SEARCHES } from '../../assist/model'
import { useAssist } from '../../assist/useAssist'
import { copyText } from '../../components/clipboard'
import { AssistProgress, Button, IconButton, ToolButton, UiIcon, buttonClass } from '../../ui'
import { DrillLink } from '../../drill'
import { REPLY_ASSIST_ID, replyCopyText } from '../utils/reply'

/**
 * FR-17.6 "Draft a helpful reply", one suggestion card under the Reddit grid. Runs the
 * shared `communities.reply` assist on open: the answer first, then who the
 * user is. CiteFox never posts (FR-17.7): the user copies the draft and posts
 * it in the thread themselves.
 */
export function ReplyDraft({
  projectId,
  pageId,
  thread,
  id,
  client,
  onClose
}: {
  projectId: string
  pageId: string | null
  thread: CommunityThread
  id: string
  client?: AssistClient
  onClose: () => void
}): JSX.Element {
  const assist = useAssist({
    assistId: REPLY_ASSIST_ID,
    projectId,
    pageId,
    inputs: { threadUrl: thread.url },
    ...(client ? { client } : {})
  })
  const { phase, result, error, description, run } = assist
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const instructionId = useId()
  const community = thread.subreddit ?? 'this thread'

  // Opening the row is the request: the draft starts at once. Under StrictMode's
  // double effect in development the first reply is dropped by `useAssist`.
  useEffect(() => {
    run(null)
  }, [run])

  const label = result?.label.text ?? description?.label.text ?? null
  const items = result?.items ?? []
  const verify = items.map((item) => item.verify).filter((text): text is string => text !== null)

  function tryAgain(): void {
    setCopied(null)
    run(instruction)
  }

  async function copy(current: AssistResult): Promise<void> {
    if (await copyText(replyCopyText(current))) setCopied(current.runId)
  }

  return (
    <div
      className="cm-reply-panel"
      id={id}
      role="region"
      aria-label={`Draft reply for ${community}`}
    >
      <div className="cm-reply-head">
        <span className="cm-reply-mark" aria-hidden="true">
          <UiIcon name="sparkle" size={14} />
        </span>
        <div className="cm-reply-titles">
          <h3 className="cm-reply-title">Draft reply for {community}</h3>
          <p className="cm-note">
            {label ?? 'CiteFox AI'} · {NO_NEW_SEARCHES} · answers the question first, then says who
            you are
          </p>
        </div>
        <IconButton icon="x" size="sm" label="Close the draft" onClick={onClose} />
      </div>
      {phase === 'running' ? (
        <AssistProgress
          progress={assist.progress}
          title="Asking CiteFox AI…"
          reads={NO_NEW_SEARCHES}
          {...(description ? { expectedSeconds: description.label.expectedSeconds } : {})}
        />
      ) : null}
      {phase === 'error' ? (
        <p className="field-error" role="alert">
          <UiIcon name="warning" size={16} />
          {error}
        </p>
      ) : null}
      {phase === 'done' && result ? (
        <>
          <blockquote className="cm-reply-quote" data-testid="cm-reply-text">
            {items.map((item) => (
              <p key={item.id} data-reply-part={item.tag ?? undefined}>
                {item.text}
              </p>
            ))}
          </blockquote>
          {verify.map((text) => (
            <p key={text} className="cm-reply-verify">
              <UiIcon name="warning" size={16} />
              Re-verify: {text}
            </p>
          ))}
        </>
      ) : null}
      <p className="cm-reply-reminder">
        <UiIcon name="warning" size={16} />
        Follow {community}&apos;s rules on self-promotion; post it yourself — CiteFox never posts
        for you.
      </p>
      <div className="cm-reply-row">
        <label className="sr-only" htmlFor={instructionId}>
          Tell CiteFox AI what to change
        </label>
        <input
          id={instructionId}
          className="ui-input ui-input-sm cm-reply-input"
          type="text"
          value={instruction}
          maxLength={ASSIST_INSTRUCTION_MAX}
          placeholder={INSTRUCTION_PLACEHOLDER}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              tryAgain()
            }
          }}
        />
        <Button
          size="sm"
          variant="primary"
          icon="copy"
          disabled={phase !== 'done' || result === null}
          onClick={() => {
            if (result) void copy(result)
          }}
        >
          {copied !== null && copied === result?.runId ? 'Copied' : 'Copy reply'}
        </Button>
        <ToolButton kind="refresh" label="Try again" disabled={phase === 'running'} onClick={tryAgain} />
        <DrillLink target={{ kind: 'url', url: thread.url }} className={buttonClass('ghost', 'sm')}>
          Open thread
        </DrillLink>
      </div>
    </div>
  )
}
