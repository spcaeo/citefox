import { useState, type JSX } from 'react'
import type { LoggedFix, Market } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { Markdown } from '../components/Markdown'
import { formatMonthDay } from '../m3/model'
import { newFixValues } from '../fixes/drawer/model'
import { openDrawer } from '../shell/drawers'
import { navigateHash, runningHash } from '../shell/routes'
import { Button, EmptyState, ListGrid, SectionHead, type ListColumn } from '../ui'
import type { ProgressAssists } from './assists'
import type { FixesSource } from './client'
import { FixCard } from './FixCard'
import { FixVerdict } from './FixDrills'
import {
  FIX_FILTERS,
  cleanError,
  filterCounts,
  filterStatus,
  fixRows,
  outcomeFor,
  savedLine,
  type FixDraft,
  type FixFilter
} from './model'
import type { FixesState } from './useFixes'
import './progress.css'

/**
 * "Fixes and what happened" (FR-14.5 to FR-14.7, Mockups/Progress.dc.html) in
 * the v2 layout: every logged fix in one list grid (filter by result, `⋯` row
 * actions), and the picked fix's before/after detail under it. `selected` is
 * the fix number on show; the screen moves it when another section links to a fix.
 * "Log a fix" opens the window-wide fix drawer on this page; the fix it logs is
 * picked here once it is saved.
 */
export function FixesSection({
  source,
  state,
  projectId,
  pageId,
  marketId,
  markets,
  now,
  assists,
  selected = null,
  onSelect
}: {
  source: FixesSource
  state: FixesState
  projectId: string
  pageId: string
  marketId: string | null
  markets: readonly Market[]
  now: Date
  assists?: ProgressAssists
  /** Fix number whose detail shows. Null: the newest fix that matches the filter. */
  selected?: number | null
  onSelect?: (number: number) => void
}): JSX.Element {
  const [filter, setFilter] = useState<FixFilter>('all')
  const [picked, setPicked] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const fixes = state.list?.fixes ?? []
  const counts = filterCounts(fixRows(fixes, marketId))
  const ordered = [...fixes].sort((a, b) => b.number - a.number)
  const shown = ordered.filter((fix) => filter === 'all' || hasFilter(fix, marketId, filter))
  const want = selected ?? picked
  const current = shown.find((fix) => fix.number === want) ?? shown[0] ?? null

  function select(number: number): void {
    setPicked(number)
    onSelect?.(number)
  }

  function openForm(next: FixDraft | null): void {
    setNotice(null)
    openDrawer(
      'fix',
      newFixValues({ pageId, promptIds: next?.promptIds ?? [], text: next?.description ?? null }),
      {
        onResult: (id) => {
          if (typeof id === 'string') void showSaved(id)
        }
      }
    )
  }

  /** The fix the drawer just logged: the list with it, and it picked. */
  async function showSaved(fixId: string): Promise<void> {
    try {
      const list = await source['fixes:list']({ projectId, pageId })
      state.replace(list)
      const saved = list.fixes.find((fix) => fix.id === fixId)
      if (saved === undefined) return
      setNotice(savedLine(saved))
      setFilter('all')
      select(saved.number)
    } catch {
      state.reload()
    }
  }

  async function runFollowUp(fix: LoggedFix): Promise<void> {
    setBusy(true)
    setActionError(null)
    try {
      await source['fixes:runFollowUp']({ projectId, fixId: fix.id })
      navigateHash(runningHash(pageId))
    } catch (cause) {
      setActionError(cleanError(cause, 'Could not start the follow-up.'))
      state.reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(fix: LoggedFix): Promise<void> {
    setBusy(true)
    setActionError(null)
    try {
      state.replace(await source['fixes:delete']({ projectId, fixId: fix.id }))
      setNotice(`Fix ${fix.number} deleted.`)
    } catch (cause) {
      setActionError(cleanError(cause, 'Could not delete the fix.'))
    } finally {
      setBusy(false)
    }
  }

  const columns: readonly ListColumn<LoggedFix>[] = [
    {
      id: 'number',
      label: 'Fix',
      width: 72,
      sort: (fix) => fix.number,
      render: (fix) => <span className="fx-num">Fix {fix.number}</span>
    },
    {
      id: 'description',
      label: 'What changed',
      width: 'fill',
      minWidth: 220,
      render: (fix) => (
        <span className="fx-grid-desc" title={plain(fix.description)}>
          <Markdown inline baseLevel={4}>
            {fix.description.split('\n')[0] ?? ''}
          </Markdown>
        </span>
      )
    },
    {
      id: 'live',
      label: 'Goes live',
      width: 104,
      sort: (fix) => fix.goLiveAt,
      render: (fix) => formatMonthDay(fix.goLiveAt)
    },
    {
      id: 'targets',
      label: 'Targets',
      width: 104,
      numeric: true,
      sort: (fix) => fix.promptIds.length,
      render: (fix) => pluralize(fix.promptIds.length, 'question')
    },
    {
      id: 'result',
      label: 'Result',
      width: 248,
      render: (fix) => <FixVerdict fix={fix} outcome={outcomeFor(fix, marketId)} />
    }
  ]

  return (
    <section className="fx-section" aria-labelledby="fix-h">
      <SectionHead
        id="fix-h"
        title="Fixes and what happened"
        description="Log a fix, pick the questions it should help, and CiteFox re-checks just those questions a few days after it goes live."
        actions={
          <Button icon="plus" onClick={() => openForm(null)}>
            Log a fix
          </Button>
        }
      />
      {state.error ? (
        <p className="bridge-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {actionError ? (
        <p className="bridge-alert" role="alert">
          {actionError}
        </p>
      ) : null}
      <p className="muted fx-notice" role="status">
        {notice ?? ''}
      </p>
      {fixes.length === 0 ? (
        state.list ? (
          <EmptyState
            title="No fixes logged yet."
            body="Log what you change on the page and CiteFox re-checks the questions it should help."
          />
        ) : (
          <p role="status">Loading fixes…</p>
        )
      ) : (
        <>
          <ListGrid<LoggedFix>
            label="Logged fixes"
            noun={['fix', 'fixes']}
            rows={shown}
            rowKey={(fix) => fix.id}
            rowLabel={(fix) => `Fix ${fix.number}`}
            columns={columns}
            initialSort={[{ key: 'number', dir: 'desc' }]}
            filter={{
              label: 'Show fixes by result',
              options: FIX_FILTERS.map((item) => ({
                value: item.id,
                label: item.label,
                count: counts[item.id]
              })),
              value: filter,
              onChange: (value) => setFilter(value as FixFilter)
            }}
            onActivate={(fix) => select(fix.number)}
            isRowCurrent={(fix) => fix.id === current?.id}
            rowMenu={(fix) => [
              {
                id: 'details',
                label: 'Show what happened',
                icon: 'eye',
                onSelect: () => select(fix.number)
              },
              ...(fix.status === 'planned'
                ? [
                    {
                      id: 'follow-up',
                      label: 'Run follow-up now',
                      icon: 'refresh' as const,
                      disabled: busy,
                      onSelect: () => void runFollowUp(fix)
                    }
                  ]
                : [])
            ]}
            summary={() => filterStatus(filter, counts)}
            empty={null}
          />
          {current ? (
            <FixCard
              key={current.id}
              fix={current}
              pageId={pageId}
              marketId={marketId}
              markets={markets}
              filter={filter}
              now={now}
              busy={busy}
              assists={assists}
              onRunFollowUp={(item) => void runFollowUp(item)}
              onDelete={(item) => void remove(item)}
            />
          ) : null}
        </>
      )}
      {assists?.suggestNextFix?.({ fixes, planFix: (next) => openForm(next) }) ?? null}
    </section>
  )
}

function hasFilter(fix: LoggedFix, marketId: string | null, filter: FixFilter): boolean {
  return fixRows([fix], marketId).some((row) => row.filter === filter)
}

function plain(text: string): string {
  return (text.split('\n')[0] ?? '').split('**').join('')
}
