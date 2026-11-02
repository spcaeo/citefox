import { useCallback, useEffect, useState } from 'react'
import type { SetSiteTypeRequest } from '@shared/ipc'
import {
  NO_SITE_TYPE_SETTINGS,
  overrideFor,
  type SiteOverride,
  type SiteTypeChoice,
  type SiteTypeSettings
} from '@shared/site-overrides'
import { SITE_ROLE_LABELS, type SiteRole } from '@shared/site-role'
import { SITE_TYPE_LABELS, type SiteType } from '@shared/site-type'
import { errorText } from '../components/errorText'
import { siteName } from '../components/answer/model'
import { displayUrl } from '../m3/model'
import { openTrackPage } from '../shell/pickerDrawers/model'
import { notifyChanged, useChangeVersion } from '../shell/changes'
import { openSiteTypes } from '../siteTypes/model'
import { showUndo } from '../ui'
import type { PromptDetailSource } from '../promptDetail/source'
import { urlKey, type SourceCompetitor, type SourceLine } from './sources'

/**
 * The channels the actions use, each optional: a screen without one gets no such
 * action (no `competitors:setSiteType`: read-only types). Prompt detail's source has
 * them all; Competitors passes its own.
 */
export type SiteActionsSource = Pick<
  PromptDetailSource,
  | 'competitors:list'
  | 'competitors:save'
  | 'competitors:remove'
  | 'competitors:restore'
  | 'competitors:siteTypes'
  | 'competitors:setSiteType'
  | 'topics:results'
  | 'topics:update'
>

/** What "Who it is" can be set to: a competitor (the list), or a role. Null: automatic. */
export type RoleChoice = SiteRole | 'competitor' | null

export interface RoleOptions {
  clearType?: boolean
}

/** A role picked for a saved competitor, waiting on "Remove … from your competitors?". */
export interface PendingRemoval {
  name: string
  role: SiteRole
  confirm: () => void
  cancel: () => void
}

export interface SourceActions {
  /** Saved competitors, to match sources against. Empty until loaded. */
  competitors: readonly SourceCompetitor[]
  /** The user's types and roles per domain, and the project's own types. */
  settings: SiteTypeSettings
  /** Own pages tracked from here this visit, by `urlKey`. */
  tracked: ReadonlySet<string>
  /** The row key being saved, else null. */
  saving: string | null
  /** Why the last action failed, else null. */
  error: string | null
  /** Saves the source's site as a competitor, with Undo. Null without the channels. */
  markCompetitor: ((line: SourceLine) => void) | null
  /** Opens Track a page with the source's address. */
  trackPage: (line: SourceLine) => void
  /** Makes the source the topic's target page, with Undo. Null for a page, or without the channels. */
  setTarget: ((line: SourceLine) => void) | null
  /** Sets the site's type for the project (null: automatic), with Undo. Null: read-only. */
  setType: ((line: SourceLine, choice: SiteTypeChoice | null) => void) | null
  /**
   * Sets who the site is for the project (null: automatic), with Undo. Null: read-only.
   * `clearType` also drops a type the user set, for a list whose one Type column shows both.
   */
  setRole: ((line: SourceLine, role: RoleChoice, options?: RoleOptions) => void) | null
  /** "+ New type…": a new type of site, then used for this site. */
  newType: ((line: SourceLine) => void) | null
  /** "Manage types…": rename, recolour or delete the project's types. */
  manageTypes: (() => void) | null
  pendingRemoval: PendingRemoval | null
}

/** No actions: the sources show who each one is, with Open and Copy only. */
export const NO_SOURCE_ACTIONS: SourceActions = {
  competitors: [],
  settings: NO_SITE_TYPE_SETTINGS,
  tracked: new Set(),
  saving: null,
  error: null,
  markCompetitor: null,
  trackPage: () => undefined,
  setTarget: null,
  setType: null,
  setRole: null,
  newType: null,
  manageTypes: null,
  pendingRemoval: null
}

const EVERYWHERE = 'On every sources list in this project.'

/**
 * The sources' quick actions on Prompt detail. Mark as competitor saves the site
 * (direct, for the whole business) and drops a role the user set on it, so the list
 * wins; the toast's Undo puts both back. A type or role is saved per domain for the
 * project, so every row with that domain changes; picking a role for a saved
 * competitor asks first, then takes it off the list.
 */
export function useSourceActions(
  source: SiteActionsSource,
  projectId: string,
  /** The topic this prompt belongs to. Null for a page. */
  topicId: string | null
): SourceActions {
  const [competitors, setCompetitors] = useState<readonly SourceCompetitor[]>([])
  const [settings, setSettings] = useState<SiteTypeSettings>(NO_SITE_TYPE_SETTINGS)
  const [tracked, setTracked] = useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)
  const competitorsChanged = useChangeVersion('competitors')
  const typesChanged = useChangeVersion('siteTypes')
  const list = source['competitors:list']
  const save = source['competitors:save']
  const remove = source['competitors:remove']
  const restore = source['competitors:restore']
  const readTypes = source['competitors:siteTypes']
  const setSiteType = source['competitors:setSiteType']

  useEffect(() => {
    if (!list) return
    let live = true
    void Promise.resolve()
      .then(() => list({ projectId }))
      .then(
        (result) => {
          if (!live) return
          setCompetitors(
            result.competitors.map((item) => ({
              id: item.id,
              name: item.name,
              domain: item.domain,
              aliases: item.aliases
            }))
          )
        },
        // No list: sources keep the class the check stored.
        () => undefined
      )
    return () => {
      live = false
    }
  }, [list, projectId, competitorsChanged])

  useEffect(() => {
    if (!readTypes) return
    let live = true
    void Promise.resolve()
      .then(() => readTypes({ projectId }))
      .then(
        (result) => {
          if (live) setSettings(result)
        },
        // No choices: every source reads automatic.
        () => undefined
      )
    return () => {
      live = false
    }
  }, [readTypes, projectId, typesChanged])

  /** Runs one change for a row; the row shows Saving… meanwhile and the card says why it failed. */
  const run = useCallback(
    async (line: SourceLine, action: () => Promise<void>, fallback: string): Promise<void> => {
      setSaving(line.key)
      setError(null)
      try {
        await action()
      } catch (cause) {
        setError(errorText(cause, fallback))
      } finally {
        setSaving(null)
      }
    },
    []
  )

  /** The domain a row's choice is saved under: the one already set for it, else its own. */
  const domainOf = useCallback(
    (line: SourceLine): string => overrideFor(line.site, settings.overrides)?.domain ?? line.site,
    [settings]
  )

  /** Saves one domain's change; Undo puts the domain's previous choice back as it was. */
  const change = useCallback(
    async (patch: SetSiteTypeRequest, message: string): Promise<void> => {
      if (!setSiteType) return
      const result = await setSiteType(patch)
      notifyChanged('siteTypes')
      showUndo({
        message,
        effect: EVERYWHERE,
        undo: async () => {
          await setSiteType(restoreOf(patch, result.previous))
          notifyChanged('siteTypes')
        }
      })
    },
    [setSiteType]
  )

  const markCompetitor = useCallback(
    (line: SourceLine): void => {
      if (!save || !restore) return
      const domain = siteName(line.url)
      const roleDomain = domainOf(line)
      void run(
        line,
        async () => {
          const saved = await save({
            projectId,
            id: null,
            name: domain,
            domain,
            aliases: [],
            tier: 'direct'
          })
          // A role set on the site would hide the list, so it goes.
          const dropped =
            line.roleEdited && setSiteType
              ? await setSiteType({ projectId, domain: roleDomain, role: null })
              : null
          notifyChanged('competitors')
          if (dropped) notifyChanged('siteTypes')
          showUndo({
            message: `${domain} is now a saved competitor.`,
            undo: async () => {
              await restore({ projectId, undoToken: saved.undoToken })
              if (dropped && setSiteType) {
                await setSiteType({
                  projectId,
                  domain: roleDomain,
                  role: dropped.previous?.role ?? null
                })
                notifyChanged('siteTypes')
              }
              notifyChanged('competitors')
            }
          })
        },
        'Could not save the competitor.'
      )
    },
    [save, restore, setSiteType, run, projectId, domainOf]
  )

  const setType = useCallback(
    (line: SourceLine, choice: SiteTypeChoice | null): void => {
      const label =
        choice === null
          ? null
          : (settings.customTypes.find((item) => `custom:${item.id}` === choice)?.name ??
            SITE_TYPE_LABELS[choice as SiteType])
      const domain = domainOf(line)
      void run(
        line,
        () =>
          change(
            { projectId, domain, type: choice },
            label === null
              ? `${domain} is back to its automatic type.`
              : `${domain} is now “${label}”.`
          ),
        'Could not save the type of site.'
      )
    },
    [settings, domainOf, run, change, projectId]
  )

  const setRole = useCallback(
    (line: SourceLine, role: RoleChoice, options: RoleOptions = {}): void => {
      if (role === 'competitor') {
        markCompetitor(line)
        return
      }
      const domain = domainOf(line)
      const patch: SetSiteTypeRequest = {
        projectId,
        domain,
        role,
        ...(options.clearType ? { type: null } : {})
      }
      const message =
        role === null
          ? `${domain} is back to automatic.`
          : `${domain} is now “${SITE_ROLE_LABELS[role]}”.`
      const saved = line.relation.kind === 'competitor' ? line.relation : null
      if (role === null || saved === null || saved.id === null || !remove || !restore) {
        void run(line, () => change(patch, message), 'Could not save who it is.')
        return
      }
      // A saved competitor leaves the list first, after the user says so.
      const { id, name } = saved
      setPendingRemoval({
        name: name ?? domain,
        role,
        cancel: () => setPendingRemoval(null),
        confirm: () => {
          setPendingRemoval(null)
          void run(
            line,
            async () => {
              const removed = await remove({ projectId, ids: [id] })
              const result = setSiteType ? await setSiteType(patch) : null
              notifyChanged('competitors')
              notifyChanged('siteTypes')
              showUndo({
                message: `${name ?? domain} is no longer a competitor. ${message}`,
                effect: EVERYWHERE,
                undo: async () => {
                  await restore({ projectId, undoToken: removed.undoToken })
                  if (result && setSiteType) {
                    await setSiteType(restoreOf(patch, result.previous))
                  }
                  notifyChanged('competitors')
                  notifyChanged('siteTypes')
                }
              })
            },
            'Could not change who it is.'
          )
        }
      })
    },
    [markCompetitor, domainOf, remove, restore, setSiteType, run, change, projectId]
  )

  const newType = useCallback(
    (line: SourceLine): void => {
      const domain = domainOf(line)
      openSiteTypes(
        { create: true, domain },
        {
          onResult: (typeId) => {
            if (typeof typeId === 'string') setType(line, `custom:${typeId}`)
          }
        }
      )
    },
    [domainOf, setType]
  )

  const trackPage = useCallback((line: SourceLine): void => {
    openTrackPage(line.url, {
      onResult: (pageId) => {
        if (typeof pageId !== 'string') return
        setTracked((current) => new Set([...current, urlKey(line.url)]))
      }
    })
  }, [])

  const readTopic = source['topics:results']
  const updateTopic = source['topics:update']
  const setTarget = useCallback(
    (line: SourceLine): void => {
      if (!readTopic || !updateTopic || topicId === null) return
      void run(
        line,
        async () => {
          // The target before, for Undo.
          const read = await readTopic({ projectId, topicId, marketId: null, runId: null })
          const before = read.topic.targetPage
          await updateTopic({ projectId, topicId, targetPage: line.url })
          showUndo({
            message: `${displayUrl(line.url)} is now this topic's target page.`,
            effect: 'The next check scores its questions against it.',
            undo: () => updateTopic({ projectId, topicId, targetPage: before })
          })
        },
        'Could not set the target page.'
      )
    },
    [readTopic, updateTopic, projectId, topicId, run]
  )

  const editable = Boolean(readTypes && setSiteType)
  return {
    competitors,
    settings,
    tracked,
    saving,
    error,
    markCompetitor: save && restore ? markCompetitor : null,
    trackPage,
    setTarget: readTopic && updateTopic && topicId !== null ? setTarget : null,
    setType: editable ? setType : null,
    setRole: editable ? setRole : null,
    newType: editable ? newType : null,
    manageTypes: editable ? () => openSiteTypes() : null,
    pendingRemoval
  }
}

/** The request that puts back what a change replaced (the fields it touched). */
function restoreOf(patch: SetSiteTypeRequest, previous: SiteOverride | null): SetSiteTypeRequest {
  return {
    projectId: patch.projectId,
    domain: patch.domain,
    ...(patch.type === undefined ? {} : { type: previous?.type ?? null }),
    ...(patch.role === undefined ? {} : { role: previous?.role ?? null })
  }
}
