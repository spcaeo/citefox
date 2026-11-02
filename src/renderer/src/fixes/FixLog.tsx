import { useId, useMemo, useState, type JSX } from 'react'
import type { LoggedFix } from '@shared/domain'
import type { FixSubject, ProjectFix } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { cleanError } from '../progress/model'
import { notifyChanged } from '../shell/changes'
import { openDrawer, useDrawerStack } from '../shell/drawers'
import { runningHash } from '../shell/routes'
import { showUndo } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import { FixConfirm, type FixAction } from './components/FixConfirm'
import { FixesGrid } from './components/FixesGrid'
import { SuggestionsGrid } from './components/SuggestionsGrid'
import { editFixValues, viewFixValues } from './drawer/model'
import { useProjectFixes } from './hooks/useProjectFixes'
import { FIXES_QUERY, filterFixes, fixStage, isStageFilter, type StageFilter } from './model'
import type { ProjectFixesSource } from './source'
import '../progress/progress.css'

/**
 * The Fix log (`?view=log`): every fix logged on a page or topic, grouped by status
 * with open ones first, what its follow-up check found, and the content gaps that
 * are not fixes yet. Every state is in the route. A row opens the window-wide fix
 * drawer; "Log a fix" (the screen header) opens it empty. Run follow-up confirms its
 * cost first; Delete acts at once and offers Undo.
 */
export function FixLog({
  projectId,
  client
}: {
  projectId: string
  client: ProjectFixesSource
}): JSX.Element {
  const state = useProjectFixes(client, projectId)
  const [query, setQuery] = useHashQuery(FIXES_QUERY)
  const [action, setAction] = useState<FixAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; pageId: string | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const selectId = useId()

  const data = state.data
  const subjects = useMemo(
    () => new Map<string, FixSubject>((data?.subjects ?? []).map((item) => [item.id, item])),
    [data]
  )
  const stage: StageFilter = isStageFilter(query.status) ? query.status : 'all'
  const subjectId = query.page !== null && subjects.has(query.page) ? query.page : null
  const all = data?.fixes ?? []
  const shown = filterFixes(all, stage, subjectId)
  const suggestions = (data?.suggestions ?? []).filter(
    (gap) => subjectId === null || gap.pageId === subjectId
  )
  // What Ask CiteFox knows here: the page or topic picked and the fix open in its drawer.
  const { stack } = useDrawerStack()
  const openFixId = stack.find((entry) => entry.id === 'fix')?.params.fix ?? null
  const selected = all.find((item) => item.fix.id === openFixId) ?? null
  const subject = subjectId === null ? null : (subjects.get(subjectId) ?? null)
  useAiContext({
    entities: [
      ...(subject ? [{ kind: subject.kind, id: subject.id, label: subject.label }] : []),
      ...(selected
        ? [{ kind: 'fix' as const, id: selected.fix.id, label: fixLabel(selected.fix) }]
        : [])
    ],
    filters: stage === 'all' ? {} : { status: stage }
  })

  async function runFollowUp(): Promise<void> {
    if (action === null) return
    const { fix } = action.item
    setBusy(true)
    setActionError(null)
    try {
      await client['fixes:runFollowUp']({ projectId, fixId: fix.id })
      setNotice({ text: `The follow-up check for Fix ${fix.number} started.`, pageId: fix.pageId })
      setAction(null)
    } catch (cause) {
      setActionError(cleanError(cause, 'Could not start the follow-up.'))
    } finally {
      setBusy(false)
      notifyChanged('fixes')
    }
  }

  async function remove(item: ProjectFix): Promise<void> {
    const { fix } = item
    setBusy(true)
    setNotice(null)
    setActionError(null)
    try {
      await client['fixes:delete']({ projectId, fixId: fix.id })
      showUndo({
        message: `Deleted Fix ${fix.number}.`,
        effect: fix.status === 'planned' ? 'Its planned follow-up is dropped too.' : null,
        undo: async () => {
          await client['fixes:restore']({ projectId, fixId: fix.id })
          notifyChanged('fixes')
        }
      })
    } catch (cause) {
      setActionError(cleanError(cause, 'Could not delete the fix.'))
    } finally {
      setBusy(false)
      notifyChanged('fixes')
    }
  }

  if (state.error && data === null) {
    return (
      <div className="fxp-view">
        <LoadError title="Could not load the fixes." message={state.error} onRetry={state.reload} />
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="fxp-view">
        <p role="status" className="muted">
          Loading fixes…
        </p>
      </div>
    )
  }

  const open = all.filter((item) => fixStage(item.fix) === 'open').length
  const pageFilter =
    data.subjects.length > 1 ? (
      <label className="fxp-field" htmlFor={selectId}>
        <span className="sr-only">Page or topic</span>
        <select
          id={selectId}
          className="select"
          value={subjectId ?? ''}
          onChange={(event) => setQuery({ page: event.target.value || null })}
        >
          <option value="">All pages and topics</option>
          {data.subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.kind === 'topic' ? `Topic · ${subject.label}` : subject.label}
            </option>
          ))}
        </select>
      </label>
    ) : null

  return (
    <div className="fxp-view">
      <p className="muted fxp-lead">
        {pluralize(all.length, 'fix', 'fixes')} across your pages and topics, {open} open. Each
        follow-up re-checks just the questions a fix should help.
      </p>
      {action ? (
        <FixConfirm
          action={action}
          busy={busy}
          onConfirm={() => void runFollowUp()}
          onCancel={() => setAction(null)}
        />
      ) : null}
      {actionError ? (
        <p className="bridge-alert" role="alert">
          {actionError}
        </p>
      ) : null}
      <p className="muted fxp-notice" role="status">
        {notice ? (
          <>
            {notice.text}{' '}
            {notice.pageId ? <a href={runningHash(notice.pageId)}>See it run</a> : null}
          </>
        ) : null}
      </p>
      <FixesGrid
        items={shown}
        all={all}
        subjects={subjects}
        stage={stage}
        selectedId={null}
        busy={busy}
        toolbar={pageFilter}
        onStage={(value) => setQuery({ status: value === 'all' ? null : value })}
        onSelect={(item) => openDrawer('fix', viewFixValues(item.fix.id))}
        onEdit={(item) => openDrawer('fix', editFixValues(item.fix.id))}
        onRun={(item) => {
          setNotice(null)
          setActionError(null)
          setAction({ kind: 'run', item })
        }}
        onDelete={(item) => void remove(item)}
      />
      {suggestions.length > 0 ? (
        <section className="fxp-gaps">
          <div className="fxp-gaps-head">
            <h2>Content gaps not fixed yet</h2>
            <p className="faint">
              From each page’s latest gap check. Log one as a fix to track what it changes.
            </p>
          </div>
          <SuggestionsGrid items={suggestions} subjects={subjects} />
        </section>
      ) : null}
    </div>
  )
}

/** "Fix 3 · Add a pricing table", as Ask CiteFox names a fix. */
function fixLabel(fix: Pick<LoggedFix, 'number' | 'description'>): string {
  return `Fix ${fix.number} · ${fix.description}`
}
