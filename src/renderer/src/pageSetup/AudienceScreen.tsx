import { useEffect, useMemo, useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import type { AssistItem, PageDetail, TriggerSuggestion } from '@shared/ipc'
import { createAssistClient, type AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { LoadError } from '../components/LoadError'
import { currentClientMode } from '../onboarding/flags'
import { pageLabel } from '../projects/copy'
import { errorText as loadErrorText } from '../components/errorText'
import type { ShellClient } from '../projects/client'
import type { TemplatesClient } from '../templates/client'
import { DrawerLevel } from '../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../shell/drawers'
import { useHashQuery } from '../utils/hashQuery'
import { Button, EmptyState, IconButton, showUndo, type HelpFillSource } from '../ui'
import { profilePartOf, profilePatchFromText, profilePatchOf } from './assistMapping'
import {
  NAMED_PARTS,
  addPointPatch,
  editPointPatch,
  namedReason,
  partsPatch,
  profileRows,
  removePointsPatch,
  type ProfilePatch,
  type ProfileRow
} from './audience/model'
import { EditProfileDrawer, PointEditor, ProfileSettingsDrawer } from './audience/panels'
import { ProfileReview } from './audience/ProfileReview'
import { useBuyerHelp } from './audience/useBuyerHelp'
import { useProfileAi, type SharpenItems } from './audience/useProfileAi'
import { useRegenerateReview } from './audience/useRegenerateReview'
import { FirstCheckBar, SetupGate, type PipelineSource } from './pipeline'
import { useLegacyPanel } from './legacyPanel'
import { usePromptContext } from './readContext'
import { errorText } from './text'
import './audience/audience.css'

type Editing = { mode: 'add' } | { mode: 'edit'; row: ProfileRow } | null

const PANEL_QUERY = ['panel'] as const

/** The add or edit form above the grid a `?panel=` value asks for. */
function editingFor(panel: string | null, rows: readonly ProfileRow[]): Editing {
  if (panel === 'add') return { mode: 'add' }
  if (panel?.startsWith('edit:')) {
    const row = rows.find((item) => item.id === panel.slice(5))
    return row ? { mode: 'edit', row } : null
  }
  return null
}

export interface AudienceScreenProps {
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  page: PageDetail
  /** Defaults to the assist client for this window. */
  assistClient?: AssistClient
  /** Runs when setup finishes writing, so the page header reloads. */
  onChanged?: () => void
  /** Tests only. Production reads the page's setup through the preload bridge. */
  pipelineSource?: PipelineSource | null
  /** Tests only. Production uses the preload bridge for ✦ Help me fill this. */
  helpFillSource?: HelpFillSource
}

/**
 * The page's Buyer profile tab (owner feedback 5, Seed-Profile.png). While the
 * profile is not written yet, the live "Setting up this page" panel; then the
 * review: points by section in one list grid, the version rail, one AI menu,
 * and the template and Regenerate in "Profile settings".
 */
export function AudienceScreen(props: AudienceScreenProps): JSX.Element {
  const [revision, setRevision] = useState(0)
  useAiContext({ entities: [{ kind: 'page', id: props.page.id, label: pageLabel(props.page) }] })
  return (
    <DrillHost>
      <SetupGate
        page={props.page}
        waitingFor="profile"
        onSettled={() => {
          setRevision((current) => current + 1)
          props.onChanged?.()
        }}
        {...(props.pipelineSource !== undefined ? { source: props.pipelineSource } : {})}
      >
        {({ pipeline, setCheckWhenReady }) => (
          <div className="ps-stack au-screen">
            <FirstCheckBar
              pipeline={pipeline}
              onCheckWhenReady={(on) => void setCheckWhenReady(on)}
            />
            <ProfileTab {...props} revision={revision} />
          </div>
        )}
      </SetupGate>
    </DrillHost>
  )
}

function ProfileTab({
  client,
  templatesClient,
  projectId,
  page,
  assistClient,
  helpFillSource,
  revision
}: AudienceScreenProps & { revision: number }): JSX.Element {
  const [profile, setProfile] = useState<BuyerProfile | null | undefined>(undefined)
  const [readStamp, setReadStamp] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The point form above the grid is `?panel=add` or `edit:<point id>`; Edit buyer profile
  // and Profile settings are drawers (`?drawer=au-edit`, `au-settings`). Back closes each.
  const [query, setQuery] = useHashQuery(PANEL_QUERY)
  const panel = query.panel
  useLegacyPanel(
    panel === 'settings'
      ? { key: 'panel', id: 'au-settings' }
      : panel === 'edit-all'
        ? { key: 'panel', id: 'au-edit' }
        : null
  )
  const editAll = useDrawerEntry('au-edit')
  const settings = useDrawerEntry('au-settings')
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const [templateId, setTemplateId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const context = usePromptContext(client, projectId, page, `${attempt}:${revision}`)
  const prompts = useMemo(() => context.prompts ?? [], [context.prompts])
  const rows = useMemo(() => (profile ? profileRows(profile, prompts) : []), [profile, prompts])
  const editing = editingFor(panel, rows)
  const openPanel = (next: string | null): void => setQuery({ panel: next })

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.getBuyerProfile({ projectId, pageId: page.id }),
      client.getRead({ projectId, pageId: page.id })
    ]).then(
      ([next, read]) => {
        if (cancelled) return
        setProfile(next)
        setReadStamp(read?.fetchedAt ?? null)
        setModified(read?.modifiedAt ?? null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(loadErrorText(cause, 'Could not load the buyer profile.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, page.id, attempt, revision])

  async function update(patch: ProfilePatch, fallback: string): Promise<BuyerProfile | null> {
    setError(null)
    try {
      const next = await client.updateBuyerProfile({ projectId, pageId: page.id, ...patch })
      setProfile(next)
      return next
    } catch (cause: unknown) {
      setError(errorText(cause, fallback))
      return null
    }
  }

  const review = useRegenerateReview({
    client,
    projectId,
    pageId: page.id,
    templateId,
    profile,
    setProfile,
    beforeReview: () => settings?.close()
  })

  async function regenerate(): Promise<void> {
    setError(null)
    try {
      await review.regenerate()
    } catch (cause: unknown) {
      setError(
        errorText(
          cause,
          profile ? 'Could not regenerate the buyer profile.' : 'Could not write the buyer profile.'
        )
      )
    }
  }

  /** Removes points; the Undo puts the sections they came from back as they were. */
  async function removePoints(current: BuyerProfile, gone: readonly ProfileRow[]): Promise<void> {
    if (gone.length === 0) return
    const previous = partsPatch(
      current,
      gone.map((row) => row.part)
    )
    const next = await update(removePointsPatch(current, gone), 'Could not remove the point.')
    if (!next) return
    showUndo({
      message:
        gone.length === 1 ? `Removed “${gone[0]?.text ?? ''}”.` : `Removed ${gone.length} points.`,
      testId: 'profile-remove-toast',
      undo: async () => {
        if (!(await update(previous, 'Could not undo the change.'))) {
          throw new Error('Could not undo the change.')
        }
      }
    })
  }

  /** Writes the chosen suggested parts; the undo puts those parts back as they were. */
  async function applySharpen(
    ids: readonly string[],
    items: SharpenItems
  ): Promise<() => Promise<void>> {
    if (!profile) throw new Error('There is no buyer profile to change yet.')
    const chosen = items.filter((item: AssistItem) => ids.length === 0 || ids.includes(item.id))
    const previous: ProfilePatch = {}
    const patch: ProfilePatch = {}
    for (const item of chosen) {
      const part = profilePartOf(item.tag)
      if (!part) continue
      Object.assign(previous, profilePatchOf(profile, part))
      Object.assign(patch, profilePatchFromText(part, item.text))
    }
    if (Object.keys(patch).length === 0) {
      setError('CiteFox AI did not say which part of the profile to change.')
      return async () => undefined
    }
    await update(patch, 'Could not save the buyer profile.')
    return async () => {
      await update(previous, 'Could not undo the change.')
    }
  }

  async function addTriggers(texts: readonly string[]): Promise<() => Promise<void>> {
    if (!profile) return async () => undefined
    const before = profile.triggers
    const fresh = texts.filter((text) => !before.includes(text))
    const next = await update({ triggers: [...before, ...fresh] }, 'Could not add the trigger.')
    if (next) setAdded((current) => new Set([...current, ...fresh]))
    return async () => {
      await update({ triggers: [...before] }, 'Could not undo the change.')
      setAdded((current) => new Set([...current].filter((text) => !fresh.includes(text))))
    }
  }

  const help = useBuyerHelp({
    projectId,
    pageId: page.id,
    profile,
    update,
    onAddedTriggers: (texts, on) =>
      setAdded((current) =>
        on
          ? new Set([...current, ...texts])
          : new Set([...current].filter((text) => !texts.includes(text)))
      ),
    ...(helpFillSource ? { source: helpFillSource } : {})
  })

  const ai = useProfileAi({
    projectId,
    pageId: page.id,
    ...(assistClient ? { assistClient } : {}),
    applySharpen,
    findTriggers: () => findTriggerEvents(assistClient, projectId, page.id),
    addTriggers,
    leadActions: [help.action]
  })

  const settingsButton = (
    <IconButton
      icon="sliders"
      label="Profile settings"
      data-tip="Profile settings"
      onClick={() => openDrawer('au-settings')}
    />
  )

  return (
    <>
      {profile ? null : <div className="au-head">{settingsButton}</div>}
      {error ? (
        <p className="ps-error" role="alert">
          {error}
        </p>
      ) : null}
      {profile === undefined && loadError ? (
        <LoadError
          title="CiteFox could not load the buyer profile."
          message={loadError}
          onRetry={() => {
            setLoadError(null)
            setAttempt((current) => current + 1)
          }}
        />
      ) : null}
      {profile === undefined && !loadError ? <p role="status">Loading the buyer profile…</p> : null}
      {profile === null ? (
        <EmptyState
          title="No buyer profile on this page"
          body="CiteFox writes it from the page when it sets the page up. Write it now if it is missing."
          action={<Button onClick={() => void regenerate()}>Write the buyer profile</Button>}
        />
      ) : null}
      {profile ? (
        <ProfileReview
          page={page}
          profile={profile}
          rows={rows}
          context={context}
          readStamp={readStamp}
          modified={modified}
          added={added}
          ai={ai.menu}
          aiCard={
            help.card && ai.card ? (
              <>
                {help.card}
                {ai.card}
              </>
            ) : (
              (help.card ?? ai.card)
            )
          }
          helper={help.panel}
          settings={settingsButton}
          editor={
            editing ? (
              <PointEditor
                key={editing.mode === 'edit' ? editing.row.id : 'add'}
                editing={editing}
                onCancel={() => openPanel(null)}
                onSave={(part, text, reason) => {
                  const patch =
                    editing.mode === 'edit'
                      ? editPointPatch(profile, editing.row, text, reason)
                      : addPointPatch(profile, part, text, reason)
                  void update(patch, 'Could not save the buyer profile.').then((next) => {
                    if (next) openPanel(null)
                  })
                }}
              />
            ) : null
          }
          onAdd={() => openPanel('add')}
          onEdit={(row) => openPanel(`edit:${row.id}`)}
          onRename={async (row, text) =>
            (await update(
              editPointPatch(profile, row, text, row.reason ?? ''),
              'Could not save the point.'
            )) !== null
          }
          onAddTo={async (part, text) => {
            const named = NAMED_PARTS.has(part) ? namedReason(text) : null
            const patch = addPointPatch(profile, part, named?.name ?? text, named?.reason ?? '')
            return (await update(patch, 'Could not add the point.')) !== null
          }}
          onRemove={(gone) => void removePoints(profile, gone)}
          onEditAll={() => openDrawer('au-edit')}
        />
      ) : null}
      {editAll && profile ? (
        <DrawerLevel depth={editAll.depth}>
          <EditProfileDrawer
            profile={profile}
            onClose={() => editAll.close()}
            onSave={async (patch) =>
              Object.keys(patch).length === 0 ||
              (await update(patch, 'Could not save the buyer profile.')) !== null
            }
          />
        </DrawerLevel>
      ) : null}
      {review.drawer}
      {settings && profile !== undefined ? (
        <DrawerLevel depth={settings.depth}>
          <ProfileSettingsDrawer
            profile={profile}
            templatesClient={templatesClient}
            templateId={templateId}
            onTemplate={setTemplateId}
            error={error}
            onRegenerate={regenerate}
            onClose={() => settings.close()}
          />
        </DrawerLevel>
      ) : null}
    </>
  )
}

/**
 * "Find more trigger events": the `audience.triggers` assist (prompt audit P7), which reads
 * the profile and the page. Each item is one named event; its tag is the page element it
 * comes from.
 */
async function findTriggerEvents(
  assistClient: AssistClient | undefined,
  projectId: string,
  pageId: string
): Promise<TriggerSuggestion[]> {
  const runner = assistClient ?? createAssistClient(currentClientMode())
  const result = await runner.run({
    assistId: 'audience.triggers',
    projectId,
    pageId,
    marketId: null,
    promptId: null,
    inputs: {},
    instruction: null
  })
  return result.items.map((item) => ({
    text: item.text,
    reason: [item.detail, item.tag === null ? null : `From the page: ${item.tag}`]
      .filter((part): part is string => part !== null)
      .join(' · ')
  }))
}
