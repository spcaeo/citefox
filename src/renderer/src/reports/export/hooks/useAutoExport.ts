import { useEffect, useState } from 'react'
import type { AutoExport } from '@shared/domain'
import type { AutoExportUnavailable } from '@shared/ipc'
import { ExportCallError, isAutoExportUnavailable, type ReportsClient } from '../../client'
import { buildExportRequest, specOf, type ExportBuildSource, type ExportForm } from '../model'

export interface Notice {
  reason: string
  nextStep: string | null
}

export interface AutoExportState {
  /** Set only when this build cannot store automatic exports; the card is then hidden. */
  unavailable: AutoExportUnavailable | null
  /** What main has stored for this scope: folder, saved settings and recent runs. */
  saved: AutoExport | null
  notice: Notice | null
  /** True right after "Save these settings" stored the current form. */
  savedNow: boolean
  toggle: () => Promise<void>
  /** Main opens the native folder dialog; the chosen folder comes back in `saved`. */
  chooseFolder: () => Promise<void>
  /** Stores the current form as the spec the next scheduled check repeats. */
  saveSettings: () => Promise<void>
}

const NO_PROJECT: Notice = {
  reason: 'No project yet.',
  nextStep: 'Create a project, then open Export again.'
}

/**
 * `exports:getAuto` on open, `exports:chooseAutoFolder` from Choose folder, and
 * `exports:setAuto` from the switch and Save these settings (FR-22.6).
 */
export function useAutoExport(
  client: ReportsClient,
  project: { id: string } | null,
  pageId: string | null,
  form: ExportForm,
  source: ExportBuildSource,
  /** Must keep its identity between renders. */
  patch: (partial: Partial<ExportForm>) => void
): AutoExportState {
  const [unavailable, setUnavailable] = useState<AutoExportUnavailable | null>(null)
  const [saved, setSaved] = useState<AutoExport | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [savedNow, setSavedNow] = useState(false)

  useEffect(() => {
    if (!project) return
    let cancelled = false
    client.getAutoExport({ projectId: project.id, pageId }).then(
      (auto) => {
        if (cancelled) return
        if (isAutoExportUnavailable(auto)) {
          if (auto.code === 'unavailable') setUnavailable(auto)
          else setNotice({ reason: auto.message, nextStep: auto.nextStep })
          setSaved(null)
          return
        }
        setUnavailable(null)
        setNotice(null)
        setSaved(auto)
        patch({
          auto: auto.enabled,
          destination: 'folder',
          ...(auto.spec ? { pattern: auto.spec.filenamePattern } : {})
        })
      },
      (error: unknown) => {
        if (cancelled) return
        setUnavailable(null)
        setNotice(autoExportNotice(error, 'Could not load automatic export.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, project, pageId, patch])

  /** Applies a result: a stored `AutoExport`, or a fixed problem shown as a notice. */
  function settle(result: AutoExport | AutoExportUnavailable): boolean {
    if (isAutoExportUnavailable(result)) {
      if (result.code === 'unavailable') {
        setUnavailable(result)
        setNotice(null)
      } else {
        setNotice({ reason: result.message, nextStep: result.nextStep })
      }
      return false
    }
    setUnavailable(null)
    setNotice(null)
    setSaved(result)
    return true
  }

  async function store(enabled: boolean, fallback: string): Promise<boolean> {
    if (!project) {
      setNotice(NO_PROJECT)
      return false
    }
    const next = { ...form, auto: enabled }
    try {
      return settle(
        await client.setAutoExport({
          projectId: project.id,
          pageId,
          enabled,
          destination: 'folder',
          folder: saved?.folder ?? null,
          emailTo: null,
          spec: specOf(buildExportRequest(next, source))
        })
      )
    } catch (error) {
      setNotice(autoExportNotice(error, fallback))
      return false
    }
  }

  async function toggle(): Promise<void> {
    const enabled = !form.auto
    setSavedNow(false)
    patch({ auto: enabled })
    const ok = await store(enabled, 'Could not save automatic export.')
    if (!ok) patch({ auto: !enabled })
  }

  async function saveSettings(): Promise<void> {
    setSavedNow(false)
    const ok = await store(form.auto, 'Could not save automatic export.')
    setSavedNow(ok)
  }

  async function chooseFolder(): Promise<void> {
    if (!project) {
      setNotice(NO_PROJECT)
      return
    }
    setSavedNow(false)
    try {
      settle(await client.chooseAutoExportFolder({ projectId: project.id, pageId }))
    } catch (error) {
      setNotice(autoExportNotice(error, 'Could not choose the folder.'))
    }
  }

  return { unavailable, saved, notice, savedNow, toggle, chooseFolder, saveSettings }
}

/** Thrown auto-export calls stay a fixed sentence. Electron's invoke wrapper is never shown. */
function autoExportNotice(error: unknown, fallback: string): Notice {
  if (error instanceof ExportCallError) return { reason: error.message, nextStep: error.nextStep }
  return { reason: fallback, nextStep: null }
}
