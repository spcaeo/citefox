import { useMemo, useState, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../../components/errorText'
import { pathOf, setItems, useScopeOptions, ItemPicker, type PickerItem } from '../../scope'
import { closeDrawer } from '../../shell/drawers'
import {
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SegmentedControl,
  UrlText
} from '../../ui'
import { notifyPagesChanged } from './changes'
import { useStackedCrumbs } from './crumbs'
import { useListHeight } from './useListHeight'
import { createPagesDrawerClient, type PagesDrawerClient } from './client'
import { useDrawerList, useDrawerValue, type PagesDrawerContext } from './params'

/** The picker row that makes a new cluster or group. */
export const NEW_TARGET = 'new'
/** The cluster picker row that takes pages out of their cluster. */
export const NO_CLUSTER = 'none'

export type MoveTarget = 'cluster' | 'group'

/** What a finished move hands back to the drawer or screen that opened it. */
export interface MoveResult {
  message: string
}

/**
 * Move pages to a cluster, or add them to a group (`move-pages` on the URL:
 * `move.ids`, `move.to` cluster|group, `move.pick` the target or `new`,
 * `move.name` a new one's name, `move.q` the search, `move.from` the cluster a
 * split starts from). One searchable list of targets with "New cluster" or
 * "New group" first, so 60 clusters never become a native select.
 */
export function MovePagesDrawer({
  context,
  client: given
}: {
  context: PagesDrawerContext
  client?: PagesDrawerClient
}): JSX.Element {
  const client = useMemo(() => given ?? createPagesDrawerClient(), [given])
  const { depth, projectId } = context
  const [ids] = useDrawerList(context, 'move.ids')
  const [toRaw, setTo] = useDrawerValue(context, 'move.to', { push: true })
  const [pick, setPick] = useDrawerValue(context, 'move.pick')
  const [name, setName] = useDrawerValue(context, 'move.name')
  const [query, setQuery] = useDrawerValue(context, 'move.q')
  const [from] = useDrawerValue(context, 'move.from')
  const to: MoveTarget = toRaw === 'group' ? 'group' : 'cluster'
  const { options, error: loadError, reload } = useScopeOptions(projectId, client)
  const crumbs = useStackedCrumbs(context, options)
  const listHeight = useListHeight(pick === NEW_TARGET ? 470 : 380, 420)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sets = useMemo(
    () => (to === 'cluster' ? (options?.clusters ?? []) : (options?.groups ?? [])),
    [options, to]
  )
  const pages = useMemo(() => {
    const wanted = new Set(ids)
    return (options?.pages ?? []).filter((page) => wanted.has(page.id))
  }, [options, ids])
  const items = useMemo<PickerItem[]>(() => {
    const fresh: PickerItem = {
      id: NEW_TARGET,
      label: to === 'cluster' ? 'New cluster…' : 'New group…',
      detail: from ? 'Split these pages off' : `With these ${ids.length.toLocaleString('en-US')}`
    }
    const none: PickerItem[] =
      to === 'cluster' && !from
        ? [{ id: NO_CLUSTER, label: 'No cluster', detail: 'Take them out of their cluster' }]
        : []
    // A set every page is in already is shown, but cannot be picked.
    const inAll = (id: string): boolean =>
      pages.length > 0 &&
      pages.every((page) => (to === 'cluster' ? page.clusterIds : page.groupIds).includes(id))
    const rest = setItems(sets.filter((set) => set.id !== from)).map((item) =>
      inAll(item.id)
        ? {
            ...item,
            disabledReason: pages.length === 1 ? 'It is in this one now' : 'They are all in it now'
          }
        : item
    )
    return [fresh, ...none, ...rest]
  }, [sets, to, from, ids.length, pages])

  const target = sets.find((set) => set.id === pick) ?? null
  const isNew = pick === NEW_TARGET
  const count = pluralize(ids.length, 'page')
  const trimmed = name.trim()
  const ready = ids.length > 0 && (isNew ? trimmed.length > 0 : pick !== '')

  const title =
    to === 'cluster' ? (from ? 'Move to a new cluster' : 'Move to cluster') : 'Add to group'
  const primaryLabel = isNew
    ? to === 'cluster'
      ? `Create cluster with ${count}`
      : `New group with these ${count}`
    : to === 'cluster'
      ? pick === NO_CLUSTER
        ? `Take ${count} out of their cluster`
        : `Move ${count}`
      : `Add ${count} to the group`

  async function run(): Promise<void> {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const message = await apply()
      notifyPagesChanged()
      closeDrawer(depth, { message } satisfies MoveResult)
    } catch (cause) {
      setError(errorText(cause, 'Could not move the pages. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<string> {
    if (to === 'cluster') {
      if (isNew && from) {
        const result = await client['structure:splitCluster']({
          projectId,
          clusterId: from,
          name: trimmed,
          pageIds: ids
        })
        return `Moved ${pluralize(result.movedCount, 'page')} to the new cluster “${trimmed}”.`
      }
      if (isNew) {
        const result = await client['structure:createCluster']({
          projectId,
          name: trimmed,
          pageIds: ids
        })
        return `Made the cluster “${trimmed}” with ${pluralize(result.movedCount, 'page')}.`
      }
      await client['structure:movePages']({
        projectId,
        pageIds: ids,
        clusterId: pick === NO_CLUSTER ? null : pick
      })
      return pick === NO_CLUSTER
        ? `Took ${count} out of their cluster.`
        : `Moved ${count} to “${target?.name ?? 'the cluster'}”.`
    }
    let groupId = pick
    let groupName = target?.name ?? 'the group'
    if (isNew) {
      const group = await client['structure:createGroup']({ projectId, name: trimmed, note: null })
      groupId = group.id
      groupName = group.name
    }
    const group = await client['structure:setGroupPages']({
      projectId,
      groupId,
      add: ids,
      remove: []
    })
    return `${isNew ? 'Made' : 'Added to'} “${groupName}”: ${pluralize(group.pageCount, 'page')} in it now.`
  }

  const shown = pages.slice(0, 6)
  return (
    <Drawer
      id="move-pages"
      {...(crumbs ? { crumbs } : {})}
      title={title}
      subtitle={`${count} · ${to === 'cluster' ? 'a page sits in one cluster at a time' : 'a page can be in any number of groups'}`}
      dirty={isNew && trimmed.length > 0}
      busy={busy}
      closeDisabled={busy}
      error={loadError ? { message: loadError, onRetry: reload } : undefined}
      loading={!options && !loadError}
      onClose={() => closeDrawer(depth)}
      headerExtra={
        from ? null : (
          <SegmentedControl<MoveTarget>
            label="Move to"
            size="sm"
            options={[
              { value: 'cluster', label: 'A cluster' },
              { value: 'group', label: 'A group' }
            ]}
            value={to}
            onChange={(next) => {
              setTo(next)
              setPick(null)
            }}
          />
        )
      }
      footer={{
        summary: error ? (
          <span role="alert" className="pd-error">
            {error}
          </span>
        ) : (
          <span>{count} · uses no searches</span>
        ),
        primary: {
          label: primaryLabel,
          disabled: !ready || busy,
          busy,
          onClick: () => void run(),
          testId: 'move-pages-run'
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title={to === 'cluster' ? 'Pick a cluster' : 'Pick a group'}
            description={
              to === 'cluster'
                ? 'Pages leave the cluster they are in now. Undo from Site structure.'
                : 'Pages stay in their other groups.'
            }
          >
            <ItemPicker
              label={to === 'cluster' ? 'Clusters' : 'Groups'}
              items={items}
              selected={pick ? [pick] : []}
              onChange={(next) => setPick(next[0] ?? null)}
              single
              noun={to === 'cluster' ? ['cluster', 'clusters'] : ['group', 'groups']}
              query={query}
              onQueryChange={setQuery}
              maxHeight={listHeight}
              testId="move-pages-picker"
            />
            {isNew ? (
              <DrawerFields>
                <DrawerField
                  label={to === 'cluster' ? 'New cluster name' : 'New group name'}
                  hint={to === 'cluster' ? 'Such as “Pricing pages”.' : 'Such as “Money pages”.'}
                >
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={name}
                      maxLength={to === 'cluster' ? 120 : 80}
                      data-autofocus
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </DrawerField>
              </DrawerFields>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail>
          <DrawerSection title="Pages" count={ids.length.toLocaleString('en-US')}>
            <ul className="pd-page-list">
              {shown.map((page) => (
                <li key={page.id}>
                  <span className="pd-page-name">{page.label}</span>
                  <UrlText className="pd-page-path" url={page.url} label={pathOf(page.url)} />
                </li>
              ))}
            </ul>
            {pages.length > shown.length ? (
              <p className="faint">and {pluralize(pages.length - shown.length, 'more page')}</p>
            ) : null}
          </DrawerSection>
          <DrawerSection title="What this changes">
            <p className="pd-note">
              {to === 'cluster'
                ? 'Cluster scores and page lists update at once. Checks and history do not change.'
                : 'The group lists these pages. Their tracking does not change.'}
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
