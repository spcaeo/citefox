import { useState, type JSX } from 'react'
import type { Notice } from '@shared/domain'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { errorText } from '../../components/errorText'
import { ListGrid, SectionHead, type ListColumn } from '../../ui'
import { formatClock, formatDay } from '../../utils/dates'
import type { NoticesState } from '../live/useNotices'

const COLUMNS: readonly ListColumn<Notice>[] = [
  {
    id: 'title',
    label: 'Decision',
    width: 280,
    sort: (notice) => notice.title.toLowerCase(),
    render: (notice) => (
      <span className="sts-strong sts-clip" title={notice.title}>
        {notice.title}
      </span>
    )
  },
  {
    id: 'body',
    label: 'What happened',
    width: 'fill',
    minWidth: 220,
    render: (notice) => (
      <span className="muted sts-clip" title={notice.body ?? undefined}>
        {notice.body ?? '—'}
      </span>
    )
  },
  {
    id: 'project',
    label: 'Project',
    width: 150,
    sort: (notice) => notice.projectName ?? '',
    render: (notice) => notice.projectName ?? <span className="faint">All projects</span>
  },
  {
    id: 'raised',
    label: 'Raised',
    width: 130,
    numeric: true,
    sort: (notice) => notice.createdAt,
    render: (notice) =>
      `${formatDay(notice.createdAt, { year: false })} ${formatClock(notice.createdAt)}`
  },
  askColumn(
    (notice) => ({ kind: 'alert', id: notice.id, label: notice.title, detail: notice.projectName }),
    (notice) => [
      `What does “${notice.title}” mean?`,
      'Which choice should I pick, and what happens next?',
      'How do I stop this from coming back?'
    ]
  )
]

/**
 * Open "ask me" notices (FR-11.4, FR-11.7) on the Status screen, as a v2 list
 * grid. The choices live in each row's `⋯` menu; a choice runs in main
 * (`notices:resolve`) and what CiteFox did is read out as a status. The capsule
 * popover keeps the compact `NoticeList`.
 */
export function NoticesGrid({ state }: { state: NoticesState }): JSX.Element {
  const { notices, message } = state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(notice: Notice, actionId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await state.resolve(notice.id, actionId)
    } catch (cause) {
      setError(errorText(cause, 'Could not apply that choice.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sts-section" aria-labelledby="st-notices">
      <SectionHead id="st-notices" title="Decisions waiting for you" />
      {notices.length > 0 ? (
        <ListGrid<Notice>
          urlKey="notices"
          label="Decisions"
          noun={['decision', 'decisions']}
          rows={notices}
          rowKey={(notice) => notice.id}
          rowLabel={(notice) => notice.title}
          columns={COLUMNS}
          initialSort={[{ key: 'raised', dir: 'desc' }]}
          rowMenu={(notice) =>
            notice.actions.map((action) => ({
              id: action.id,
              label: action.label,
              ...(action.primary ? { icon: 'check' as const } : {}),
              disabled: busy,
              onSelect: () => void choose(notice, action.id)
            }))
          }
          empty={null}
        />
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
    </section>
  )
}
