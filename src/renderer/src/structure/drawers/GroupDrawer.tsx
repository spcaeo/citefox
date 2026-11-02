import { useCallback, useMemo, useState, type JSX } from 'react'
import type { GroupPageRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { openTarget } from '../../drill'
import { closeDrawer, closeDrawersThen, openDrawer } from '../../shell/drawers'
import { pagesHash, structureHash } from '../../shell/routes'
import {
  Button,
  Confirm,
  Drawer,
  DrawerGrid,
  DrawerSection,
  EmptyState,
  IconButton,
  ListGrid,
  type MenuItem
} from '../../ui'
import { QUICK_TRACK } from '../constants'
import { pagePath } from '../utils/model'
import { createPagesDrawerClient, type PagesDrawerClient } from './client'
import { checkableIds, memberColumns, memberName, untrackedIds } from './memberColumns'
import type { MoveResult } from './MovePagesDrawer'
import { useDrawerList, useDrawerValue, type PagesDrawerContext } from './params'
import { useMembers } from './useMembers'

const CSV_HEADER = ['Page', 'URL', 'Tracking', 'Score']

/**
 * One group's pages in the 80% drawer (`group`: `group.id`, `group.q`,
 * `group.pick`). "Add pages" stacks the page picker on it. Bulk: Remove from
 * group, Track, Check now, Export. Footer: the counts, Delete group, Open in
 * All pages, Add pages.
 */
export function GroupDrawer({
  context,
  client: given
}: {
  context: PagesDrawerContext
  client?: PagesDrawerClient
}): JSX.Element {
  const client = useMemo(() => given ?? createPagesDrawerClient(), [given])
  const { depth, projectId } = context
  const [groupId] = useDrawerValue(context, 'group.id')
  const [query, setQuery] = useDrawerValue(context, 'group.q')
  const [picked, setPicked] = useDrawerList(context, 'group.pick')
  const loadView = useCallback(() => client['structure:get']({ projectId }), [client, projectId])
  const loadRows = useCallback(
    () => client['structure:groupPages']({ projectId, groupId }).then((list) => list.pages),
    [client, projectId, groupId]
  )
  const state = useMembers<GroupPageRow>(loadView, loadRows, `${projectId}\0${groupId}`)
  const { view, rows, act, busy } = state
  const group = view?.groups.find((item) => item.id === groupId) ?? null
  const gone = view !== null && group === null
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const all = rows ?? []
  const disabled = busy !== null
  const columns = useMemo(() => memberColumns<GroupPageRow>(), [])

  function addPages(): void {
    openDrawer(
      'pick-pages',
      { 'pick.for': `group:${groupId}` },
      {
        onResult: (result) => {
          const message = (result as MoveResult | undefined)?.message
          if (message) setNote(message)
        }
      }
    )
  }

  async function removeFromGroup(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const result = await act('Remove from group', () =>
      client['structure:setGroupPages']({ projectId, groupId, add: [], remove: ids })
    )
    if (result) {
      setNote(`Removed ${pluralize(ids.length, 'page')} from the group. The pages stay in CiteFox.`)
      setPicked([])
    }
  }

  async function track(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const result = await act('Track pages', () =>
      client['import:track']({ projectId, pageIds: ids, urls: [], markets: [], ...QUICK_TRACK })
    )
    if (result) {
      setNote(
        `Tracking ${pluralize(result.trackedCount, 'page')} in the project default market. Pages that are not set up start at Read page.`
      )
      setPicked([])
    }
  }

  function checkNow(ids: readonly string[]): void {
    if (ids.length === 0) return
    openDrawer('check-now', { 'check.scope': 'pages', 'check.ids': ids.join(',') })
  }

  async function exportRows(list: readonly GroupPageRow[]): Promise<void> {
    const result = await act('Export', () =>
      client['grid:exportCsv']({
        fileName: `${(group?.name ?? 'group').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-pages.csv`,
        header: CSV_HEADER,
        rows: list.map((row) => [
          memberName(row),
          row.url,
          row.status,
          row.score === null ? '' : String(row.score)
        ])
      })
    )
    if (result) {
      setNote(
        result.ok
          ? `Exported ${pluralize(result.rowCount, 'row')} to ${result.fileName}.`
          : result.message
      )
    }
  }

  async function remove(): Promise<void> {
    const result = await act('Delete group', () =>
      client['structure:deleteGroup']({ projectId, groupId })
    )
    setConfirmDelete(false)
    if (result) closeDrawer(depth, { message: `Deleted “${group?.name ?? 'the group'}”.` })
  }

  function rowMenu(row: GroupPageRow): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'open',
        label: 'Open page',
        icon: 'arrow-right',
        onSelect: () => openTarget({ kind: 'page', pageId: row.pageId })
      }
    ]
    if (checkableIds([row]).length > 0) {
      items.push({
        id: 'check',
        label: 'Check now…',
        icon: 'refresh',
        onSelect: () => checkNow([row.pageId])
      })
    }
    if (untrackedIds([row]).length > 0) {
      items.push({
        id: 'track',
        label: 'Track this page',
        icon: 'plus',
        disabled,
        onSelect: () => void track([row.pageId])
      })
    }
    items.push({
      id: 'remove',
      label: `Remove from ${group?.name ?? 'the group'}`,
      icon: 'x',
      tone: 'danger',
      groupStart: true,
      disabled,
      onSelect: () => void removeFromGroup([row.pageId])
    })
    return items
  }

  const summary = state.actionError ? (
    <span role="alert" className="pd-error">
      {state.actionError}
    </span>
  ) : (
    <span className="pd-foot">
      <span className="num">
        {pluralize(group?.pageCount ?? all.length, 'page')} ·{' '}
        {(group?.trackedCount ?? 0).toLocaleString('en-US')} tracked
      </span>
      {note ? (
        <span role="status" className="pd-note-inline">
          {note}
        </span>
      ) : null}
    </span>
  )

  return (
    <>
      <Drawer
        id="group"
        title={group?.name ?? 'Group'}
        trail={[{ label: 'Groups', href: structureHash('groups') }]}
        subtitle={group ? `Made by you${group.note ? ` · ${group.note}` : ''}` : undefined}
        focusOnOpen="close"
        busy={busy !== null}
        loading={(!view || !rows) && !state.error && groupId !== ''}
        error={
          state.error
            ? { message: state.error, onRetry: state.reload }
            : gone || groupId === ''
              ? { message: 'This group isn’t available any more.' }
              : undefined
        }
        onClose={() => closeDrawer(depth)}
        footer={{
          summary,
          cancel: 'Close',
          danger: {
            label: 'Delete group',
            icon: 'trash',
            disabled,
            onClick: () => setConfirmDelete(true),
            testId: 'group-delete'
          },
          secondary: {
            label: 'Open in All pages',
            onClick: () => closeDrawersThen(pagesHash({ group: groupId }))
          },
          primary: {
            label: 'Add pages',
            icon: 'plus',
            disabled: !group,
            onClick: addPages,
            testId: 'group-add-pages'
          }
        }}
      >
        {group && rows ? (
          <DrawerGrid>
            <DrawerSection tone="plain" className="pd-list">
              <ListGrid<GroupPageRow>
                label={`Pages in ${group.name}`}
                noun={['page', 'pages']}
                rows={all}
                rowKey={(row) => row.pageId}
                rowLabel={memberName}
                columns={columns}
                search={{
                  text: (row) => `${memberName(row)} ${pagePath(row.url)}`,
                  placeholder: 'Search pages'
                }}
                searchValue={query}
                onSearchChange={(value) => setQuery(value || null)}
                selection={picked}
                onSelectionChange={setPicked}
                rowMenu={rowMenu}
                onActivate={(row) => openTarget({ kind: 'page', pageId: row.pageId })}
                fitPage
                maxBodyHeight={520}
                actions={
                  <IconButton
                    icon="download"
                    size="sm"
                    label="Export CSV"
                    data-tip="Export CSV"
                    disabled={disabled}
                    onClick={() => void exportRows(all)}
                  />
                }
                bulk={({ selected }) => {
                  const ids = selected.map((row) => row.pageId)
                  const untracked = untrackedIds(selected)
                  const checkable = checkableIds(selected)
                  return (
                    <>
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => void removeFromGroup(ids)}
                      >
                        Remove from group
                      </Button>
                      {untracked.length > 0 ? (
                        <Button
                          size="sm"
                          icon="plus"
                          disabled={disabled}
                          onClick={() => void track(untracked)}
                        >
                          Track {pluralize(untracked.length, 'page')}
                        </Button>
                      ) : null}
                      {checkable.length > 0 ? (
                        <Button size="sm" onClick={() => checkNow(checkable)}>
                          Check now
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => void exportRows(selected)}
                      >
                        Export
                      </Button>
                    </>
                  )
                }}
                empty={
                  <EmptyState
                    compact
                    icon="layers"
                    title="No pages yet"
                    body="Pick pages from every page CiteFox found on your site."
                    action={
                      <Button size="sm" icon="plus" onClick={addPages}>
                        Add pages
                      </Button>
                    }
                  />
                }
              />
            </DrawerSection>
          </DrawerGrid>
        ) : null}
      </Drawer>
      {confirmDelete && group ? (
        <Confirm
          title={`Delete ${group.name}?`}
          body={`The group goes; its ${pluralize(group.pageCount, 'page')} stay in CiteFox with their tracking and history.`}
          confirmLabel="Delete group"
          busy={busy === 'Delete group'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
          testId="group-delete-confirm"
        />
      ) : null}
    </>
  )
}
