import { useEffect, useMemo, useState, type JSX } from 'react'
import type { CompetitorsList, SavedCompetitor } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { notifyChanged } from '../../shell/changes'
import type { DrawerEntry } from '../../shell/drawerUrl'
import { closeDrawer, setDrawerParams } from '../../shell/drawers'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection, showUndo } from '../../ui'
import { createCompetitorsSource, type CompetitorsSource } from '../source'
import { CompetitorFields, MergePicker } from './CompetitorFields'
import './competitor-drawer.css'
import {
  competitorParamsFrom,
  formErrors,
  formFrom,
  hasErrors,
  mergeLabel,
  saveRequest,
  sameForm,
  type CompetitorForm
} from './model'

/**
 * The `competitor` drawer (window-wide): Add competitor (`competitor=new`), Edit
 * (`competitor=<id>`) with Remove and Merge with…, and Merge
 * (`competitor.mode=merge`, the picked ids in `competitor.ids`). Every change acts at
 * once and offers Undo in the toast. It closes with the saved competitor's id, so an
 * opener can pick it.
 */
export function CompetitorDrawer({
  projectId,
  entry,
  depth,
  source
}: {
  projectId: string
  entry: DrawerEntry
  depth: number
  source?: CompetitorsSource
}): JSX.Element {
  const client = useMemo(() => source ?? createCompetitorsSource(), [source])
  const params = competitorParamsFrom(entry.params)
  const [list, setList] = useState<CompetitorsList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => client['competitors:list']({ projectId }))
      .then(
        (next) => {
          if (live) setList(next)
        },
        (cause: unknown) => {
          if (live) setLoadError(errorText(cause, 'Could not load the saved competitors.'))
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, reloads])

  const close = (result?: unknown): void => closeDrawer(depth, result)
  const saved =
    params.id === null ? null : (list?.competitors.find((item) => item.id === params.id) ?? null)

  if (list !== null && params.id !== null && saved === null) {
    return (
      <Drawer
        id="competitor"
        title="Competitor"
        onClose={() => close()}
        error={{ message: 'That competitor is not saved any more, or is not available to you.' }}
      />
    )
  }
  if (list === null) {
    return (
      <Drawer
        id="competitor"
        title={params.mode === 'add' ? 'Add competitor' : 'Edit competitor'}
        loading={loadError === null}
        error={
          loadError === null
            ? undefined
            : {
                message: loadError,
                onRetry: () => {
                  setLoadError(null)
                  setReloads((value) => value + 1)
                }
              }
        }
        onClose={() => close()}
      />
    )
  }
  if (params.mode === 'merge' && saved !== null) {
    return (
      <MergeBody
        client={client}
        projectId={projectId}
        depth={depth}
        list={list}
        saved={saved}
        picked={params.ids}
        onClose={close}
      />
    )
  }
  return (
    <EditBody
      key={saved?.id ?? 'new'}
      client={client}
      projectId={projectId}
      depth={depth}
      list={list}
      saved={saved}
      onClose={close}
    />
  )
}

function EditBody({
  client,
  projectId,
  depth,
  list,
  saved,
  onClose
}: {
  client: CompetitorsSource
  projectId: string
  depth: number
  list: CompetitorsList
  saved: SavedCompetitor | null
  onClose: (result?: unknown) => void
}): JSX.Element {
  const initial = useMemo(() => formFrom(saved), [saved])
  const [form, setForm] = useState<CompetitorForm>(initial)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasProducts = list.products.length > 0
  const errors = formErrors(form, hasProducts)
  const dirty = !sameForm(form, initial)
  const others = list.competitors.filter((item) => item.id !== saved?.id)

  async function save(): Promise<void> {
    setTried(true)
    if (hasErrors(errors)) return
    setBusy('save')
    setError(null)
    try {
      const result = await client['competitors:save'](
        saveRequest(projectId, saved?.id ?? null, form, hasProducts)
      )
      const name = result.competitor?.name ?? form.name
      notifyChanged('competitors')
      onClose(result.competitor?.id)
      showUndo({
        message: saved === null ? `Added ${name} as a competitor.` : `Saved ${name}.`,
        undo: () => restore(client, projectId, result.undoToken)
      })
    } catch (cause) {
      setError(errorText(cause, 'Could not save the competitor.'))
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    if (saved === null) return
    setBusy('remove')
    setError(null)
    try {
      const result = await client['competitors:remove']({ projectId, ids: [saved.id] })
      notifyChanged('competitors')
      onClose()
      showUndo({
        message: `Removed ${saved.name} from competitors.`,
        effect: 'Past checks keep their results; its links count as other sites now.',
        undo: () => restore(client, projectId, result.undoToken)
      })
    } catch (cause) {
      setError(errorText(cause, 'Could not remove the competitor.'))
      setBusy(null)
    }
  }

  return (
    <Drawer
      id="competitor"
      title={saved === null ? 'Add competitor' : `Edit ${saved.name}`}
      subtitle={
        saved === null
          ? 'A company whose links in AI Overviews you want to count apart from other sites.'
          : 'Its links count as this competitor from the next load of Competitors.'
      }
      dirty={dirty && busy === null}
      closeDisabled={busy !== null}
      busy={busy !== null}
      onClose={() => onClose()}
      footer={{
        summary: error ? (
          <span role="alert" className="cmp-drawer-error">
            {error}
          </span>
        ) : undefined,
        danger:
          saved === null
            ? undefined
            : {
                label: 'Remove',
                icon: 'trash',
                busy: busy === 'remove',
                disabled: busy !== null,
                ariaLabel: `Remove ${saved.name} from competitors`,
                onClick: () => void remove()
              },
        secondary:
          saved === null || others.length === 0
            ? undefined
            : {
                label: 'Merge with…',
                disabled: busy !== null,
                onClick: () =>
                  setDrawerParams(depth, { 'competitor.mode': 'merge' }, { push: true })
              },
        primary: {
          label: saved === null ? 'Add competitor' : 'Save changes',
          busy: busy === 'save',
          disabled: busy !== null || (saved !== null && !dirty),
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="Competitor">
            <CompetitorFields
              form={form}
              errors={tried ? errors : {}}
              products={list.products}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            />
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="How links are matched">
          <DrawerSection title="How links are matched">
            <p className="muted">
              A cited link counts as this competitor when its site is the domain, one of the other
              domains, or a subdomain of either. Direct competitors sell what you sell; partial ones
              overlap on some of it.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

function MergeBody({
  client,
  projectId,
  depth,
  list,
  saved,
  picked,
  onClose
}: {
  client: CompetitorsSource
  projectId: string
  depth: number
  list: CompetitorsList
  saved: SavedCompetitor
  picked: readonly string[]
  onClose: (result?: unknown) => void
}): JSX.Element {
  const others = list.competitors.filter((item) => item.id !== saved.id)
  const ids = picked.filter((id) => others.some((item) => item.id === id))
  const [name, setName] = useState(saved.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(next: readonly string[]): void {
    // The picks are on the URL, so a copied link opens the same merge.
    setDrawerParams(depth, { 'competitor.ids': next.length > 0 ? next.join(',') : null })
  }

  async function merge(): Promise<void> {
    if (ids.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const trimmed = name.trim()
      const result = await client['competitors:merge']({
        projectId,
        ids: [saved.id, ...ids],
        intoId: saved.id,
        ...(trimmed && trimmed !== saved.name ? { name: trimmed } : {})
      })
      notifyChanged('competitors')
      onClose(result.competitor?.id)
      showUndo({
        message: `Merged ${result.names.join(', ')} into ${result.competitor?.name ?? saved.name}.`,
        effect: 'Every domain is kept, so their links now count as one competitor.',
        undo: () => restore(client, projectId, result.undoToken)
      })
    } catch (cause) {
      setError(errorText(cause, 'Could not merge the competitors.'))
      setBusy(false)
    }
  }

  return (
    <Drawer
      id="competitor"
      title={`Merge ${saved.name} with…`}
      subtitle="The same company saved under more than one name: keep one, with every domain."
      dirty={(ids.length > 0 || name.trim() !== saved.name) && !busy}
      closeDisabled={busy}
      busy={busy}
      onClose={() => onClose()}
      footer={{
        summary: error ? (
          <span role="alert" className="cmp-drawer-error">
            {error}
          </span>
        ) : ids.length > 0 ? (
          `${ids.length + 1} competitors become ${name.trim() || saved.name}`
        ) : undefined,
        primary: {
          label: mergeLabel(ids.length),
          busy,
          disabled: busy || ids.length === 0 || name.trim() === '',
          onClick: () => void merge()
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <MergePicker
            saved={saved}
            others={others}
            picked={ids}
            name={name}
            onPick={pick}
            onName={setName}
          />
        </DrawerMain>
        <DrawerRail label="What a merge keeps">
          <DrawerSection title="What a merge keeps">
            <p className="muted">
              The name you keep, every domain as one of its domains, every product any of them
              competes with, and Direct if any of them is direct. Undo puts them back.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

async function restore(
  client: CompetitorsSource,
  projectId: string,
  undoToken: string
): Promise<void> {
  await client['competitors:restore']({ projectId, undoToken })
  notifyChanged('competitors')
}
