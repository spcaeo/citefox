import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { GenerationTemplate, GenerationTemplateKind } from '@shared/domain'
import type { TemplateUsage } from '@shared/ipc'
import type { TemplatesClient } from '../client'
import { suggestedDuplicateName, templatesOfKind } from '../model'
import {
  nameFieldMessage,
  notesFieldMessage,
  notesForSave,
  readTemplateFailure,
  templateNameError,
  templateNotesError
} from '../name'
import { hasTemplateError } from '../utils/highlight'
import { SYNTAX_MESSAGE } from './useStepDraft'

export type LibraryMode = 'selected' | 'create' | 'duplicate'
export type UsageScope = 'all' | 'project'

export interface AppLibrary {
  loading: boolean
  loadError: string | null
  live: readonly GenerationTemplate[]
  deleted: readonly GenerationTemplate[]
  selected: GenerationTemplate | null
  duplicateSource: GenerationTemplate | null
  mode: LibraryMode
  /** The selected template is the shipped one, so it is read-only. */
  shipped: boolean
  showDeleted: boolean
  setShowDeleted: Dispatch<SetStateAction<boolean>>
  scope: UsageScope
  setScope: (scope: UsageScope) => void
  usages: Readonly<Record<string, TemplateUsage>>
  nameDraft: string
  setNameDraft: (value: string) => void
  notesDraft: string
  setNotesDraft: (value: string) => void
  bodyDraft: string
  setBodyDraft: Dispatch<SetStateAction<string>>
  editing: boolean
  setEditing: Dispatch<SetStateAction<boolean>>
  nameError: string | null
  setNameError: (value: string | null) => void
  notesError: string | null
  setNotesError: (value: string | null) => void
  formError: string | null
  setFormError: (value: string | null) => void
  savedNote: string | null
  setSavedNote: (value: string | null) => void
  busy: boolean
  dirty: boolean
  fill: (template: GenerationTemplate) => void
  openCreate: () => void
  openDuplicate: (template: GenerationTemplate) => void
  save: () => Promise<void>
  makeDefault: (id: string) => Promise<void>
  remove: () => Promise<void>
  restore: (id: string) => Promise<void>
}

/**
 * The named app templates of one step (FR-10.2): create, duplicate, edit name,
 * notes and body, set as default, delete and restore, and usage counts. Shared by
 * every project. `onChanged` runs after anything that can change what a step runs.
 */
export function useAppLibrary(input: {
  client: TemplatesClient
  kind: GenerationTemplateKind
  projectId: string | null
  /** Bumped by the step editor after it saved the app default. */
  revision: number
  onChanged: () => void
}): AppLibrary {
  const { client, kind, projectId, revision, onChanged } = input
  const [templates, setTemplates] = useState<readonly GenerationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<LibraryMode>('selected')
  const [duplicateFromId, setDuplicateFromId] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [scope, setScope] = useState<UsageScope>('all')
  const [usages, setUsages] = useState<Readonly<Record<string, TemplateUsage>>>({})
  const [nameDraft, setNameDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shownKind, setShownKind] = useState<GenerationTemplateKind | null>(null)
  /** The template as it was when the editor was filled. Dirty is measured against it. */
  const [filled, setFilled] = useState<GenerationTemplate | null>(null)

  const clearMessages = useCallback(() => {
    setNameError(null)
    setNotesError(null)
    setFormError(null)
    setSavedNote(null)
  }, [])

  const fill = useCallback(
    (template: GenerationTemplate) => {
      setSelectedId(template.id)
      setFilled(template)
      setMode('selected')
      setDuplicateFromId(null)
      setNameDraft(template.name)
      setNotesDraft(template.notes ?? '')
      setBodyDraft(template.body)
      setEditing(false)
      clearMessages()
    },
    [clearMessages]
  )

  const selectFirst = useCallback(
    (list: readonly GenerationTemplate[], of: GenerationTemplateKind) => {
      const live = templatesOfKind(list, of, false)
      const first = live.find((item) => item.isDefault) ?? live[0]
      if (first) fill(first)
      else {
        setSelectedId(null)
        setMode('selected')
      }
    },
    [fill]
  )

  useEffect(() => {
    let cancelled = false
    void client.list({ includeDeleted: true }).then(
      (list) => {
        if (cancelled) return
        setTemplates(list)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setLoadError(readTemplateFailure(cause))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, revision])

  // A new step (or the first load) opens that step's default template.
  if (!loading && shownKind !== kind) {
    setShownKind(kind)
    setShowDeleted(false)
    selectFirst(templates, kind)
  }

  const selected = templates.find((item) => item.id === selectedId) ?? null
  const duplicateSource = templates.find((item) => item.id === duplicateFromId) ?? null
  const live = templatesOfKind(templates, kind, false)
  const deleted = templatesOfKind(templates, kind, true)
  const shipped = mode === 'selected' && selected?.isShipped === true

  useEffect(() => {
    const ids = templates.filter((item) => item.kind === kind).map((item) => item.id)
    if (ids.length === 0) return
    let cancelled = false
    void Promise.all(
      ids.map(async (id) => {
        const usage = await client.usage(
          scope === 'project' && projectId ? { id, projectId } : { id }
        )
        return [id, usage] as const
      })
    ).then(
      (pairs) => {
        if (!cancelled) setUsages(Object.fromEntries(pairs))
      },
      () => {
        if (!cancelled) setUsages({})
      }
    )
    return () => {
      cancelled = true
    }
  }, [templates, kind, scope, projectId, client])

  const dirty = ((): boolean => {
    if (mode === 'create' || mode === 'duplicate') {
      return nameDraft.length > 0 || notesDraft.length > 0
    }
    if (!filled || filled.isShipped) return false
    return (
      nameDraft.trim() !== filled.name ||
      notesForSave(notesDraft) !== filled.notes ||
      bodyDraft !== filled.body
    )
  })()

  // A clean editor follows a template saved elsewhere (the step editor with no project open).
  if (
    mode === 'selected' &&
    selected !== null &&
    filled !== null &&
    selected.id === filled.id &&
    (selected.version !== filled.version || selected.isDefault !== filled.isDefault) &&
    !dirty
  ) {
    fill(selected)
  }

  async function refresh(): Promise<readonly GenerationTemplate[]> {
    const list = await client.list({ includeDeleted: true })
    setTemplates(list)
    return list
  }

  function openCreate(): void {
    setMode('create')
    setDuplicateFromId(null)
    setNameDraft('')
    setNotesDraft('')
    setBodyDraft('{{ url }}\n')
    setEditing(true)
    clearMessages()
  }

  function openDuplicate(template: GenerationTemplate): void {
    setMode('duplicate')
    setDuplicateFromId(template.id)
    setNameDraft(suggestedDuplicateName(template.name))
    setNotesDraft(template.notes ?? '')
    setBodyDraft(template.body)
    setEditing(false)
    clearMessages()
  }

  function validateFields(): boolean {
    const nextName = templateNameError(nameDraft)
    const nextNotes = templateNotesError(notesDraft)
    setNameError(nextName)
    setNotesError(nextNotes)
    return nextName === null && nextNotes === null
  }

  function applyFailure(error: unknown): void {
    const nameMessage = nameFieldMessage(error)
    const notesMessage = notesFieldMessage(error)
    if (nameMessage) setNameError(nameMessage)
    else if (notesMessage) setNotesError(notesMessage)
    else setFormError(readTemplateFailure(error))
    setSavedNote(null)
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (busy || !validateFields()) return
    if (mode !== 'duplicate' && hasTemplateError(bodyDraft, kind)) {
      setFormError(SYNTAX_MESSAGE)
      return
    }
    const name = nameDraft.trim()
    const notes = notesForSave(notesDraft)
    await run(async () => {
      try {
        if (mode === 'create') {
          const created = await client.create({ kind, name, notes, body: bodyDraft })
          await refresh()
          fill(created)
          setSavedNote('Created. It is not the default until you set it.')
        } else if (mode === 'duplicate') {
          if (!duplicateSource) return
          const created = await client.create({
            kind: duplicateSource.kind,
            name,
            notes,
            fromId: duplicateSource.id
          })
          await refresh()
          fill(created)
          setSavedNote(
            'Duplicated. The copy is yours to edit. The shipped template stays read-only.'
          )
        } else if (selected && !selected.isShipped) {
          const result = await client.update({ id: selected.id, name, notes, body: bodyDraft })
          await refresh()
          fill(result.template)
          setSavedNote(
            `Saved as v${result.template.version}. Existing results keep the wording from when they were generated. The next run uses this wording.`
          )
          if (result.template.isDefault) onChanged()
        }
      } catch (error) {
        applyFailure(error)
      }
    })
  }

  async function makeDefault(id: string): Promise<void> {
    await run(async () => {
      try {
        const updated = await client.setDefault({ id })
        const list = await refresh()
        const current = list.find((item) => item.id === updated.id)
        if (current) fill(current)
        setSavedNote('This template is now the default for its step.')
        onChanged()
      } catch (error) {
        setFormError(readTemplateFailure(error))
      }
    })
  }

  async function remove(): Promise<void> {
    if (!selected) return
    await run(async () => {
      try {
        await client.delete({ id: selected.id })
        const list = await refresh()
        setShowDeleted(true)
        const next = templatesOfKind(list, kind, false)[0]
        if (next) fill(next)
        else {
          setSelectedId(null)
          clearMessages()
        }
      } catch (error) {
        setFormError(readTemplateFailure(error))
      }
    })
  }

  async function restore(id: string): Promise<void> {
    await run(async () => {
      try {
        const restored = await client.restore({ id })
        await refresh()
        fill(restored)
        setSavedNote('Restored.')
      } catch (error) {
        applyFailure(error)
      }
    })
  }

  return {
    loading,
    loadError,
    live,
    deleted,
    selected,
    duplicateSource,
    mode,
    shipped,
    showDeleted,
    setShowDeleted,
    scope,
    setScope,
    usages,
    nameDraft,
    setNameDraft,
    notesDraft,
    setNotesDraft,
    bodyDraft,
    setBodyDraft,
    editing,
    setEditing,
    nameError,
    setNameError,
    notesError,
    setNotesError,
    formError,
    setFormError,
    savedNote,
    setSavedNote,
    busy,
    dirty,
    fill,
    openCreate,
    openDuplicate,
    save,
    makeDefault,
    remove,
    restore
  }
}
