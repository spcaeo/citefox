import { useMemo, useState, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../../components/errorText'
import { ItemPicker, pageItems, useScopeOptions, type ScopePage } from '../../scope'
import { closeDrawer } from '../../shell/drawers'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection
} from '../../ui'
import { notifyPagesChanged } from './changes'
import { useStackedCrumbs } from './crumbs'
import { useListHeight } from './useListHeight'
import { createPagesDrawerClient, type PagesDrawerClient } from './client'
import type { MoveResult } from './MovePagesDrawer'
import { useDrawerList, useDrawerValue, type PagesDrawerContext } from './params'
import { parsePickFor, type PickFor } from './pickFor'

const ANY = ''
const NO_CLUSTER = 'none'
const TOP_FOLDER = '/'

/**
 * Pick pages from every page in the project (`pick-pages`: `pick.for`,
 * `pick.q`, `pick.ids`, `pick.folder`, `pick.cluster`, `pick.name`). Search,
 * folder and cluster filters, and "Pick all N" stay fast over 2,000 pages.
 * Adds them to a group (`structure:setGroupPages`), moves them into a cluster
 * (`structure:movePages`), or makes a new cluster (`structure:createCluster`).
 */
export function PickPagesDrawer({
  context,
  client: given
}: {
  context: PagesDrawerContext
  client?: PagesDrawerClient
}): JSX.Element {
  const client = useMemo(() => given ?? createPagesDrawerClient(), [given])
  const { depth, projectId } = context
  const [forRaw] = useDrawerValue(context, 'pick.for')
  const [query, setQuery] = useDrawerValue(context, 'pick.q')
  const [picked, setPicked] = useDrawerList(context, 'pick.ids')
  const [folder, setFolder] = useDrawerValue(context, 'pick.folder')
  const [cluster, setCluster] = useDrawerValue(context, 'pick.cluster')
  const [name, setName] = useDrawerValue(context, 'pick.name')
  const target = parsePickFor(forRaw)
  const { options, error: loadError, reload } = useScopeOptions(projectId, client)
  const crumbs = useStackedCrumbs(context, options)
  const listHeight = useListHeight(target?.kind === 'new-cluster' ? 590 : 420, 460)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set =
    target === null || target.kind === 'new-cluster'
      ? null
      : ((target.kind === 'group' ? options?.groups : options?.clusters) ?? []).find(
          (item) => item.id === target.id
        )
  const missing = options !== null && target !== null && target.kind !== 'new-cluster' && !set
  const folders = useMemo(
    () =>
      [...new Set((options?.pages ?? []).map((page) => page.folder ?? TOP_FOLDER))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [options]
  )
  const pillarOf = target?.kind === 'pillar' ? target.id : null
  const filtered = useMemo(
    () =>
      (options?.pages ?? []).filter(
        (page) =>
          (pillarOf === null || page.clusterIds.includes(pillarOf)) &&
          (folder === ANY || (page.folder ?? TOP_FOLDER) === folder) &&
          (cluster === ANY ||
            (cluster === NO_CLUSTER
              ? page.clusterIds.length === 0
              : page.clusterIds.includes(cluster)))
      ),
    [options, folder, cluster, pillarOf]
  )
  const items = useMemo(
    () => pageItems(filtered, (page) => alreadyIn(page, target)),
    [filtered, target]
  )
  const trimmed = name.trim()
  const count = pluralize(picked.length, 'page')
  const ready =
    picked.length > 0 && (target?.kind === 'new-cluster' ? trimmed.length > 0 : Boolean(set))

  const title =
    target?.kind === 'new-cluster'
      ? 'New cluster'
      : target?.kind === 'pillar'
        ? `Set the pillar of ${set?.name ?? 'the cluster'}`
        : set
          ? `Add pages to ${set.name}`
          : 'Add pages'
  const primaryLabel =
    target?.kind === 'new-cluster'
      ? `Create cluster with ${count}`
      : target?.kind === 'pillar'
        ? 'Set as pillar'
        : target?.kind === 'cluster'
          ? `Move ${count} here`
          : `Add ${count}`

  async function run(): Promise<void> {
    if (!ready || target === null) return
    setBusy(true)
    setError(null)
    try {
      let message: string
      if (target.kind === 'new-cluster') {
        const result = await client['structure:createCluster']({
          projectId,
          name: trimmed,
          pageIds: picked
        })
        message = `Made the cluster “${trimmed}” with ${pluralize(result.movedCount, 'page')}.`
      } else if (target.kind === 'pillar') {
        const pageId = picked[0] ?? ''
        await client['structure:setPageRole']({
          projectId,
          clusterId: target.id,
          pageId,
          role: 'pillar'
        })
        const page = options?.pages.find((item) => item.id === pageId)
        message = `${page?.label ?? 'The page'} is the pillar of “${set?.name ?? 'the cluster'}” now.`
      } else if (target.kind === 'cluster') {
        await client['structure:movePages']({ projectId, pageIds: picked, clusterId: target.id })
        message = `Moved ${count} to “${set?.name ?? 'the cluster'}”.`
      } else {
        const group = await client['structure:setGroupPages']({
          projectId,
          groupId: target.id,
          add: picked,
          remove: []
        })
        message = `Added ${count} to “${group.name}”: ${pluralize(group.pageCount, 'page')} in it now.`
      }
      notifyPagesChanged()
      closeDrawer(depth, { message } satisfies MoveResult)
    } catch (cause) {
      setError(errorText(cause, 'Could not add the pages. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const toolbar = (
    <>
      <label className="pd-filter">
        <span className="sr-only">Folder</span>
        <select
          className="select"
          value={folder}
          aria-label="Folder"
          onChange={(event) => setFolder(event.target.value || null)}
        >
          <option value={ANY}>All folders</option>
          {folders.map((item) => (
            <option key={item} value={item}>
              {item === TOP_FOLDER ? 'Top level' : `/${item}/`}
            </option>
          ))}
        </select>
      </label>
      {(options?.clusters.length ?? 0) > 0 ? (
        <label className="pd-filter">
          <span className="sr-only">Cluster</span>
          <select
            className="select"
            value={cluster}
            aria-label="Cluster"
            onChange={(event) => setCluster(event.target.value || null)}
          >
            <option value={ANY}>All clusters</option>
            <option value={NO_CLUSTER}>No cluster</option>
            {(options?.clusters ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  )

  return (
    <Drawer
      id="pick-pages"
      {...(crumbs ? { crumbs } : {})}
      title={title}
      subtitle={
        target?.kind === 'new-cluster'
          ? 'Name the cluster and pick its pages. They leave the clusters they are in now.'
          : target?.kind === 'pillar'
            ? 'The page the cluster’s other pages should link to.'
            : 'Search, filter by folder or cluster, and pick as many pages as you need.'
      }
      dirty={picked.length > 0 || trimmed.length > 0}
      busy={busy}
      closeDisabled={busy}
      loading={!options && !loadError}
      error={
        loadError
          ? { message: loadError, onRetry: reload }
          : target === null || missing
            ? { message: 'This list is not available any more.' }
            : undefined
      }
      onClose={() => closeDrawer(depth)}
      footer={{
        summary: error ? (
          <span role="alert" className="pd-error">
            {error}
          </span>
        ) : (
          <span>{count} picked · uses no searches</span>
        ),
        primary: {
          label: primaryLabel,
          disabled: !ready || busy,
          busy,
          onClick: () => void run(),
          testId: 'pick-pages-run'
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          {target?.kind === 'new-cluster' ? (
            <DrawerSection title="Name">
              <DrawerFields>
                <DrawerField label="Cluster name" hint="Such as “Pricing pages”.">
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={name}
                      maxLength={120}
                      data-autofocus
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </DrawerField>
              </DrawerFields>
            </DrawerSection>
          ) : null}
          <DrawerSection
            title="Pages"
            count={filtered.length.toLocaleString('en-US')}
            className="pd-pick-section"
          >
            <ItemPicker
              label="Pages to pick"
              items={items}
              selected={picked}
              onChange={setPicked}
              single={target?.kind === 'pillar'}
              noun={['page', 'pages']}
              placeholder="Search pages by title or URL"
              query={query}
              onQueryChange={setQuery}
              toolbar={target?.kind === 'pillar' ? undefined : toolbar}
              site={options?.domain ?? null}
              maxHeight={listHeight}
              testId="pick-pages-picker"
            />
          </DrawerSection>
        </DrawerMain>
        <DrawerRail>
          <DrawerSection title="Where they go" className="pd-facts">
            <DrawerFacts
              items={[
                {
                  label: target?.kind === 'group' ? 'Group' : 'Cluster',
                  value:
                    target?.kind === 'new-cluster' ? trimmed || 'New cluster' : (set?.name ?? '—')
                },
                ...(set ? [{ label: 'In it now', value: pluralize(set.count, 'page') }] : []),
                { label: 'Picked', value: count }
              ]}
            />
          </DrawerSection>
          <DrawerSection title="What this changes">
            <p className="pd-note">
              {target?.kind === 'group'
                ? 'The group lists these pages too. Their clusters and tracking stay as they are.'
                : target?.kind === 'pillar'
                  ? 'The old pillar becomes a supporting page. Nothing is searched.'
                  : 'A page sits in one cluster at a time, so picked pages leave their old cluster. Undo from Site structure.'}
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

function alreadyIn(page: ScopePage, target: PickFor | null): string | null {
  if (target === null || target.kind === 'new-cluster' || target.kind === 'pillar') return null
  if (target.kind === 'group')
    return page.groupIds.includes(target.id) ? 'Already in this group' : null
  return page.clusterIds.includes(target.id) ? 'Already in this cluster' : null
}
