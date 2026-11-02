import { useState, type JSX } from 'react'
import type { Notice } from '@shared/domain'
import { errorText } from '../../components/errorText'
import { Button } from '../../ui'
import { formatClock, formatDay } from '../../utils/dates'
import type { NoticesState } from '../live/useNotices'

/**
 * Open "ask me" notices (FR-11.4, FR-11.7) with their choices. A choice runs
 * in main (`notices:resolve`); what CiteFox did is read out as a status.
 * The Status screen and the capsule popover both use this list.
 */
export function NoticeList({
  state,
  headingLevel = 3,
  label = 'Decisions waiting for you'
}: {
  state: NoticesState
  headingLevel?: 3 | 4
  label?: string
}): JSX.Element {
  const { notices, message } = state
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const Heading = headingLevel === 3 ? 'h3' : 'h4'

  async function choose(notice: Notice, actionId: string): Promise<void> {
    setBusy(notice.id)
    setError(null)
    try {
      await state.resolve(notice.id, actionId)
    } catch (cause) {
      setError(errorText(cause, 'Could not apply that choice.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="st-notices">
      {notices.length > 0 ? (
        <ul className="st-keys" aria-label={label}>
          {notices.map((notice) => (
            <li key={notice.id} className="st-key st-notice">
              <Heading className="st-notice-title">{notice.title}</Heading>
              <span className="faint sts-small">
                {[
                  notice.projectName,
                  `${formatDay(notice.createdAt, { year: false })} ${formatClock(notice.createdAt)}`
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {notice.body ? <span className="muted">{notice.body}</span> : null}
              <div className="st-buttons">
                {notice.actions.map((action) => (
                  <Button
                    key={action.id}
                    size="sm"
                    variant={action.primary ? 'primary' : 'secondary'}
                    disabled={busy !== null}
                    onClick={() => void choose(notice, action.id)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <span className="sts-small" role="status">
          {message}
        </span>
      ) : null}
      {error ? (
        <span className="st-problem" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
