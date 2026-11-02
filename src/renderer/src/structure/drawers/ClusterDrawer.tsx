import { useCallback, useMemo, useState, type JSX } from 'react'
import type { ClusterPageRow, ClusterRole, ClusterSummary } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { openTarget } from '../../drill'
import { closeDrawer, openDrawer } from '../../shell/drawers'
import { pageHash, structureHash } from '../../shell/routes'
import {
  Button,
  buttonClass,
  Chip,
  Confirm,
  Drawer,
  DrawerGrid,
  DrawerSection,
  EmptyState,
  ListGrid,
  MenuButton,
  Tabs,
  type ListColumn,
  type MenuItem
} from '../../ui'
import { QUICK_TRACK, ROLE_LABELS, ROLE_LEGEND } from '../constants'
import { pagePath } from '../utils/model'
import { createPagesDrawerClient, type PagesDrawerClient } from './client'
import { memberColumns, memberName, untrackedIds } from './memberColumns'
import { NEW_TARGET, type MoveResult } from './MovePagesDrawer'
import { useDrawerList, useDrawerValue, type PagesDrawerContext } from './params'
import { useMembers } from './useMembers'
import { useLinkSuggestions } from '../hooks/useLinkSuggestions'
import { LinkSuggestionsCard } from '../components/LinkSuggestions'

type ClusterTab = 'pages' | 'themes'

const ROLE_ORDER: Readonly<Record<ClusterRole, number>> = { pillar: 0, supporting: 1, orphan: 2 }
const ROLE_TONE: Readonly<Record<ClusterRole, 'ok' | 'neutral' | 'warn'>> = {
  pillar: 'ok',
  supporting: 'neutral',
  orphan: 'warn'
}
const MAKER: Readonly<Record<ClusterSummary['madeBy'], string>> = {
  rules: 'CiteFox',
  claude: 'CiteFox AI',
  user: 'You'
}

/**
 * One cluster's pages in the 80% drawer (`cluster`: `cluster.id`,
 * `cluster.tab`, `cluster.q`, `cluster.pick`). Bulk on pages: Track, Move to
 * cluster, Move to a new cluster (split), Set role, Add to group, Take out.
 * Footer: the counts, Delete cluster, Track cluster.
 */
export function ClusterDrawer({
  context,
  client: given
}: {
  context: PagesDrawerContext
  client?: PagesDrawerClient
}): JSX.Element {
  const client = useMemo(() => given ?? createPagesDrawerClient(), [given])
  const { depth, projectId } = context
  const [clusterId] = useDrawerValue(context, 'cluster.id')
  const [tabRaw, setTab] = useDrawerValue(context, 'cluster.tab', { push: true })
  const [query, setQuery] = useDrawerValue(context, 'cluster.q')
  const [picked, setPicked] = useDrawerList(context, 'cluster.pick')
  const loadView = useCallback(() => client['structure:get']({ projectId }), [client, projectId])
  const loadRows = useCallback(
    () => client['structure:clusterPages']({ projectId, clusterId }).then((list) => list.pages),
    [client, projectId, clusterId]
  )
  const state = useMembers<ClusterPageRow>(loadView, loadRows, `${projectId}\0${clusterId}`)
  const { view, rows, act, busy } = state
  const cluster = view?.clusters.find((item) => item.id === clusterId) ?? null
  const gone = view !== null && cluster === null
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const links = useLinkSuggestions(client, projectId, clusterId)
  const themes = cluster?.themePrompts?.filter((theme) => theme.prompts.length > 0) ?? []
  const tab: ClusterTab = tabRaw === 'themes' && themes.length > 0 ? 'themes' : 'pages'
  const all = rows ?? []
  const trackedCount = cluster?.trackedCount ?? 0
  const disabled = busy !== null

  function move(ids: readonly string[], extra: Record<string, string> = {}): void {
    openDrawer(
      'move-pages',
      { 'move.ids': ids.join(','), 'move.to': 'cluster', ...extra },
      { onResult: (result) => done(result, true) }
    )
  }

  function addToGroup(ids: readonly string[]): void {
    openDrawer(
      'move-pages',
      { 'move.ids': ids.join(','), 'move.to': 'group' },
      { onResult: (result) => done(result, false) }
    )
  }

  function done(result: unknown, clearPick: boolean): void {
    const message = (result as MoveResult | undefined)?.message
    if (message) setNote(message)
    if (clearPick) setPicked([])
  }

  async function track(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const result = await act('Track pages', () =>
      client['import:track']({
        projectId,
        pageIds: ids,
        urls: [],
        markets: [],
        ...QUICK_TRACK
      })
    )
    if (result) {
      setNote(
        `Tracking ${pluralize(result.trackedCount, 'page')} in the project default market. Pages that are not set up start at Read page.`
      )
      setPicked([])
    }
  }

  async function setRole(pageId: string, role: ClusterRole): Promise<void> {
    const result = await act('Set role', () =>
      client['structure:setPageRole']({ projectId, clusterId, pageId, role })
    )
    if (result) setNote(`Set as ${ROLE_LABELS[role].toLowerCase()}.`)
  }

  async function setRoles(ids: readonly string[], role: ClusterRole): Promise<void> {
    const result = await act('Set role', async () => {
      for (const pageId of ids) {
        await client['structure:setPageRole']({ projectId, clusterId, pageId, role })
      }
      return ids.length
    })
    if (result !== null) {
      setNote(`${pluralize(result, 'page')} set as ${ROLE_LABELS[role].toLowerCase()}.`)
      setPicked([])
    }
  }

  async function takeOut(ids: readonly string[]): Promise<void> {
    const result = await act('Take out of the cluster', () =>
      client['structure:movePages']({ projectId, pageIds: ids, clusterId: null })
    )
    if (result) {
      setNote(
        `Took ${pluralize(ids.length, 'page')} out of this cluster. Undo from Site structure.`
      )
      setPicked([])
    }
  }

  async function trackWhole(on: boolean): Promise<void> {
    const result = await act('Track cluster', () =>
      client['structure:trackCluster']({ projectId, clusterId, track: on })
    )
    if (result) {
      setNote(
        on
          ? `Tracking the whole cluster: ${pluralize(result.trackedCount, 'page')} started now, and new pages the sync adds to it.`
          : 'New pages the sync adds to this cluster are no longer tracked. Tracked pages stay tracked.'
      )
    }
  }

  async function remove(): Promise<void> {
    const result = await act('Delete cluster', () =>
      client['structure:deleteCluster']({ projectId, clusterId })
    )
    setConfirmDelete(false)
    if (result) closeDrawer(depth, { message: `Deleted “${cluster?.name ?? 'the cluster'}”.` })
  }

  const columns = useMemo<ListColumn<ClusterPageRow>[]>(() => {
    const base = memberColumns<ClusterPageRow>()
    const role: ListColumn<ClusterPageRow> = {
      id: 'role',
      label: 'Role',
      width: 112,
      sort: (row) => ROLE_ORDER[row.role],
      render: (row) => (
        <span className="pd-role">
          <Chip size="sm" tone={ROLE_TONE[row.role]}>
            {ROLE_LABELS[row.role]}
          </Chip>
          {row.movedByUser ? <span className="faint">moved</span> : null}
        </span>
      )
    }
    return [base[0], base[1], role, ...base.slice(2)].filter(
      (column): column is ListColumn<ClusterPageRow> => column !== undefined
    )
  }, [])

  function rowMenu(row: ClusterPageRow): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'open',
        label: 'Open page',
        icon: 'arrow-right',
        onSelect: () => openTarget({ kind: 'page', pageId: row.pageId })
      }
    ]
    if (untrackedIds([row]).length > 0) {
      items.push({
        id: 'track',
        label: 'Track this page',
        icon: 'plus',
        disabled,
        onSelect: () => void track([row.pageId])
      })
    }
    items.push(
      row.role === 'pillar'
        ? {
            id: 'support',
            label: 'Set as supporting',
            icon: 'layers',
            disabled,
            onSelect: () => void setRole(row.pageId, 'supporting')
          }
        : {
            id: 'pillar',
            label: 'Set as pillar',
            icon: 'target',
            disabled,
            onSelect: () => void setRole(row.pageId, 'pillar')
          },
      {
        id: 'move',
        label: 'Move to cluster…',
        icon: 'arrow-right',
        groupStart: true,
        onSelect: () => move([row.pageId])
      },
      {
        id: 'group',
        label: 'Add to group…',
        icon: 'plus',
        onSelect: () => addToGroup([row.pageId])
      },
      {
        id: 'out',
        label: 'Take out of this cluster',
        icon: 'x',
        tone: 'danger',
        disabled,
        onSelect: () => void takeOut([row.pageId])
      }
    )
    return items
  }

  const pagesTab = (
    <ListGrid<ClusterPageRow>
      label={`Pages in ${cluster?.name ?? 'this cluster'}`}
      noun={['page', 'pages']}
      rows={all}
      rowKey={(row) => row.pageId}
      rowLabel={memberName}
      columns={columns}
      search={{ text: (row) => `${memberName(row)} ${row.url}`, placeholder: 'Search pages' }}
      searchValue={query}
      onSearchChange={(value) => setQuery(value || null)}
      selection={picked}
      onSelectionChange={setPicked}
      rowMenu={rowMenu}
      onActivate={(row) => openTarget({ kind: 'page', pageId: row.pageId })}
      initialSort={[{ key: 'role', dir: 'asc' }]}
      fitPage
      maxBodyHeight={520}
      bulk={({ selected }) => {
        const ids = selected.map((row) => row.pageId)
        const untracked = untrackedIds(selected)
        const roleItems: MenuItem[] = [
          ...(ids.length === 1
            ? [
                {
                  id: 'pillar',
                  label: 'Pillar',
                  onSelect: () => void setRoles(ids, 'pillar')
                }
              ]
            : []),
          {
            id: 'supporting',
            label: 'Supporting',
            onSelect: () => void setRoles(ids, 'supporting')
          },
          { id: 'orphan', label: 'Orphan', onSelect: () => void setRoles(ids, 'orphan') }
        ]
        return (
          <>
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
            <Button size="sm" disabled={disabled} onClick={() => move(ids)}>
              Move to cluster
            </Button>
            <Button
              size="sm"
              disabled={disabled || ids.length >= all.length}
              title={
                ids.length >= all.length
                  ? 'Leave at least one page here, or rename the cluster instead.'
                  : undefined
              }
              onClick={() => move(ids, { 'move.pick': NEW_TARGET, 'move.from': clusterId })}
            >
              Move to new cluster
            </Button>
            <MenuButton
              label="Set role"
              items={roleItems}
              align="start"
              trigger={(props) => (
                <button {...props} type="button" className={buttonClass('secondary', 'sm')}>
                  Set role
                </button>
              )}
            />
            <Button size="sm" disabled={disabled} onClick={() => addToGroup(ids)}>
              Add to group
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void takeOut(ids)}>
              Remove
            </Button>
          </>
        )
      }}
      empty={
        <EmptyState
          compact
          title="No pages in this cluster"
          body="Move pages here from All pages or from another cluster."
        />
      }
    />
  )

  const themesTab = (
    <div className="pd-themes">
      {themes.map((theme) => (
        <DrawerSection
          key={theme.theme}
          title={theme.theme}
          count={theme.prompts.length}
          span={6}
          description="Questions behind this theme, with the page they belong to."
        >
          <ul className="pd-theme-list">
            {theme.prompts.map((prompt) => (
              <li key={`${prompt.pageId}:${prompt.promptId}`}>
                <a href={pageHash(prompt.pageId, 'prompts')}>
                  Q{prompt.position} · {prompt.label}
                </a>
                <span className="faint">{prompt.pageLabel}</span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      ))}
    </div>
  )

  const pillar = cluster?.pillarTitle ?? (cluster?.pillarUrl ? pagePath(cluster.pillarUrl) : null)
  const summary = state.actionError ? (
    <span role="alert" className="pd-error">
      {state.actionError}
    </span>
  ) : (
    <span className="pd-foot">
      <span className="num">
        {pluralize(cluster?.pageCount ?? all.length, 'page')} ·{' '}
        {trackedCount.toLocaleString('en-US')} tracked
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
        id="cluster"
        title={cluster?.name ?? 'Cluster'}
        trail={[{ label: 'Clusters', href: structureHash('clusters') }]}
        subtitle={
          cluster
            ? `Made by ${MAKER[cluster.madeBy]}${cluster.editedByUser && cluster.madeBy !== 'user' ? ' · edited by you' : ''} · pillar: ${pillar ?? 'not chosen yet'}${cluster.trackWhole ? ' · tracked whole' : ''}`
            : undefined
        }
        status={cluster?.trackWhole ? <Chip tone="ok">Tracked whole</Chip> : undefined}
        focusOnOpen="close"
        busy={busy !== null}
        loading={(!view || !rows) && !state.error && clusterId !== ''}
        error={
          state.error
            ? { message: state.error, onRetry: state.reload }
            : gone || clusterId === ''
              ? { message: 'This cluster isn’t available any more.' }
              : undefined
        }
        headerExtra={
          themes.length > 0 ? (
            <Tabs<ClusterTab>
              label="Cluster sections"
              size="sm"
              tabs={[
                { id: 'pages', label: 'Pages', count: all.length },
                { id: 'themes', label: 'Themes', count: themes.length }
              ]}
              value={tab}
              onChange={(next) => setTab(next === 'pages' ? null : next)}
            />
          ) : undefined
        }
        onClose={() => closeDrawer(depth)}
        footer={{
          summary,
          cancel: 'Close',
          danger: {
            label: 'Delete cluster',
            icon: 'trash',
            disabled,
            onClick: () => setConfirmDelete(true),
            testId: 'cluster-delete'
          },
          ...(cluster?.trackWhole
            ? {
                secondary: {
                  label: 'Stop tracking new pages',
                  disabled,
                  onClick: () => void trackWhole(false)
                }
              }
            : {
                primary: {
                  label: 'Track cluster',
                  icon: 'plus',
                  disabled,
                  busy: busy === 'Track cluster',
                  onClick: () => void trackWhole(true),
                  testId: 'cluster-track'
                }
              })
        }}
      >
        {cluster && rows ? (
          <DrawerGrid>
            <DrawerSection
              tone="plain"
              className="pd-list"
              description={tab === 'pages' ? ROLE_LEGEND : undefined}
              actions={
                tab === 'pages' ? (
                  // Rule-based (no Claude), so it is a plain button, not an AI menu line.
                  <Button
                    size="sm"
                    icon="merge"
                    busy={links.status === 'loading'}
                    title="Rule-based, from the cluster's pages. No AI, no searches."
                    onClick={links.load}
                  >
                    Suggest internal links
                  </Button>
                ) : undefined
              }
            >
              {tab === 'pages' ? (
                <>
                  <LinkSuggestionsCard state={links} />
                  {pagesTab}
                </>
              ) : (
                themesTab
              )}
            </DrawerSection>
          </DrawerGrid>
        ) : null}
      </Drawer>
      {confirmDelete && cluster ? (
        <Confirm
          title={`Delete ${cluster.name}?`}
          body={`Its ${pluralize(cluster.pageCount, 'page')} become unclustered. Pages, tracking and history stay. You can undo from Site structure.`}
          confirmLabel="Delete cluster"
          busy={busy === 'Delete cluster'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
          testId="cluster-delete-confirm"
        />
      ) : null}
    </>
  )
}
