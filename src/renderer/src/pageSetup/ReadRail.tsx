import type { JSX } from 'react'
import type { PageReadProgress, PageReadResult } from '@shared/ipc'
import { pageHash } from '../shell/routes'
import { Button, Chip, Panel, UiIcon } from '../ui'
import { readMethodLabel } from './labels'
import { formatDuration, formatReadStamp, shortHash } from './model'
import type { PromptContext } from './readContext'
import { PromptCount } from './readDrills'
import { phrasePromptIds, promiseSourceIds } from './readMatch'
import { ProgressList } from './ReadStatus'

/** The successful read: how and when, with Read again and the Jina fallback. */
export function ReadOk({
  result,
  pageId,
  busy,
  phases,
  onAgain,
  onJina
}: {
  result: PageReadResult
  pageId: string
  busy: boolean
  phases: readonly PageReadProgress[]
  onAgain: () => void
  onJina: () => void
}): JSX.Element {
  return (
    <Panel label="Read status" padding={20}>
      <p className="rd-ok">
        <UiIcon name="check" size={16} />
        <span>
          Page read ·{' '}
          <span className="mono">
            {result.httpStatus === null ? 'file' : `${result.httpStatus} OK`}
          </span>
        </span>
      </p>
      <p className="rd-faint">
        {formatDuration(result.durationMs)} · {formatReadStamp(result.fetchedAt)} ·{' '}
        {readMethodLabel(result.method)}
      </p>
      {result.snapshotReused ? (
        <p className="rd-muted">
          {result.message}
          {result.id ? (
            <>
              {' '}
              Snapshot{' '}
              <a
                className="mono"
                href={pageHash(pageId, 'history')}
                aria-label={`Snapshot ${result.id}: compare content in History`}
              >
                {result.id}
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}
      {busy ? <ProgressList phases={phases} /> : null}
      <div className="rd-actions">
        <Button size="sm" disabled={busy} onClick={onAgain}>
          Read again
        </Button>
        {result.method === 'jina' ? null : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onJina}>
            Read with the backup reader instead
          </Button>
        )}
      </div>
    </Panel>
  )
}

/** The AI menu line (`page.promises`) that writes the promises panel. */
export const PROMISES_ACTION = 'Summarize what this page promises'

/** "What the page is targeting": Claude's promises, each opening the prompts on it. */
export function ReadPromises({
  result,
  context
}: {
  result: PageReadResult
  context: PromptContext
}): JSX.Element {
  const promiseIds = promiseSourceIds(context.prompts ?? [])
  const promisePrompts = (context.prompts ?? []).filter((prompt) => promiseIds.includes(prompt.id))
  return (
    <Panel
      title="What the page is targeting"
      actions={
        <PromptCount
          context={context}
          id="read:promises"
          title="Questions written from the title, meta and H1"
          description="Buyer questions CiteFox wrote from what the page leads with. Select one to see its AI Overview."
          ids={promiseIds}
        />
      }
    >
      <p className="rd-faint rd-panel-note">
        <Chip size="sm">CiteFox AI · on your plan</Chip> From the title, meta, H1 and body. The
        buyer profile and questions start here.
      </p>
      {result.summary && result.summary.promises.length > 0 ? (
        <ol className="rd-promises">
          {result.summary.promises.map((promise, index) => (
            <li key={promise.title}>
              <span className="rd-num num">{index + 1}</span>
              <div className="rd-grow">
                <p className="rd-strong">{promise.title}</p>
                <p className="rd-muted">{promise.detail}</p>
              </div>
              <PromptCount
                context={context}
                id={`read:promise:${index}`}
                title={`Questions on “${promise.title}”`}
                description="Questions written from the title, meta and H1 that ask about this promise."
                ids={phrasePromptIds(promise.title, promisePrompts)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rd-muted">No summary yet. Choose “{PROMISES_ACTION}” in the AI menu.</p>
      )}
      {result.summary?.product ? (
        <p>
          <strong>Product behind it:</strong> {result.summary.product}
        </p>
      ) : null}
    </Panel>
  )
}

/** Body text: word count and the content fingerprint History compares. */
export function ReadBody({
  result,
  pageId
}: {
  result: PageReadResult
  pageId: string
}): JSX.Element {
  return (
    <Panel title="Body text">
      <p>
        <span className="mono">{result.wordCount.toLocaleString('en-US')}</span> words
        {result.contentHash ? (
          <>
            {' · '}
            content fingerprint <span className="mono">{shortHash(result.contentHash)}</span>
          </>
        ) : null}
      </p>
      {result.contentHash ? (
        <p className="rd-faint">
          CiteFox compares this fingerprint on every check to tell you when the page changed.{' '}
          <a href={pageHash(pageId, 'history')}>Compare content in History</a>
        </p>
      ) : null}
      <p>
        <a href={pageHash(pageId, 'gaps')}>See all page-wide fixes</a>
      </p>
    </Panel>
  )
}
