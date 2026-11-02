import { useState, type JSX } from 'react'
import { errorText } from '../../../components/errorText'
import { Confirm } from '../../../ui'
import type { ClustersSource } from '../../clusters'
import { countText, type TopicLine } from '../model'
import type { ActionDone } from './TopicActionDrawer'

/**
 * "Delete this topic?" (`#/topics?action=delete&topic=<id>`): it stops being
 * tracked and leaves the list; its questions and history are kept, and Undo is
 * offered after.
 */
export function TopicDeleteConfirm({
  line,
  projectId,
  source,
  onClose,
  onDone
}: {
  line: TopicLine
  projectId: string
  source: ClustersSource
  onClose: () => void
  onDone: (done: ActionDone) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await source['topics:update']({ projectId, topicId: line.id, status: 'removed' })
      onDone({
        message: `Deleted ${line.name}. Its questions and history are kept.`,
        deleted: { id: line.id, name: line.name }
      })
    } catch (cause) {
      setError(errorText(cause, 'That did not work. Try again.'))
      setBusy(false)
    }
  }

  return (
    <Confirm
      title="Delete this topic?"
      body={
        <>
          <p>
            <strong>{line.name}</strong> stops being tracked and leaves the list. Its{' '}
            {countText(line.rows.length, 'question')} and their history are kept, and you can undo
            this.
          </p>
          {error ? (
            <p className="ui-drawer-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
      confirmLabel="Delete topic"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void remove()}
      testId="topic-delete-confirm"
    />
  )
}
