import { useCallback } from 'react'
import { useQueryState, writeQuery } from '../../utils/queryState'

/**
 * A section card's URL state (BRIEF "Every state has a URL"): the step is
 * `#/setup/<step>` (OnboardingApp's), an open panel is `?open=<section>.<panel>`
 * and the row open for editing is `&edit=<itemId>`. Opening pushes a history
 * entry, so Back closes it; closing rewrites the entry in place.
 */

export const SECTION_PANELS = ['redo', 'prompt', 'chatgpt', 'menu'] as const

export type SectionPanel = (typeof SECTION_PANELS)[number]

export const OPEN_KEY = 'open'
export const EDIT_KEY = 'edit'

/** `buyers.redo` → `{ section: 'buyers', panel: 'redo' }`. Anything else is null. */
export function parseOpen(value: string | null): { section: string; panel: SectionPanel } | null {
  if (!value) return null
  const at = value.lastIndexOf('.')
  if (at <= 0) return null
  const section = value.slice(0, at)
  const panel = value.slice(at + 1)
  return SECTION_PANELS.some((item) => item === panel)
    ? { section, panel: panel as SectionPanel }
    : null
}

export function formatOpen(section: string, panel: SectionPanel): string {
  return `${section}.${panel}`
}

export interface SectionUrl {
  /** This section's open panel, or null. */
  panel: SectionPanel | null
  /** The id in `edit=`, whatever section it belongs to (a section checks its own rows). */
  editId: string | null
  /** Opens a panel (a new history entry); from the ⋯ menu it replaces the menu's entry. */
  openPanel: (panel: SectionPanel) => void
  /** Opens the panel, or closes it when it is open. */
  togglePanel: (panel: SectionPanel) => void
  closePanel: () => void
  /** Opens a row (or a text section, by its section id) for editing. Closes any panel. */
  startEdit: (id: string) => void
  stopEdit: () => void
}

export function useSectionUrl(section: string): SectionUrl {
  const [open] = useQueryState(OPEN_KEY)
  const [editId] = useQueryState(EDIT_KEY)
  const parsed = parseOpen(open)
  const panel = parsed !== null && parsed.section === section ? parsed.panel : null

  const openPanel = useCallback(
    (next: SectionPanel) => {
      // Menu → panel swaps the entry, so Back from the panel skips the menu.
      writeQuery(
        { [OPEN_KEY]: formatOpen(section, next), [EDIT_KEY]: null },
        panel === 'menu' ? 'replace' : 'push'
      )
    },
    [section, panel]
  )

  const closePanel = useCallback(() => {
    if (panel !== null) writeQuery({ [OPEN_KEY]: null }, 'replace')
  }, [panel])

  const togglePanel = useCallback(
    (next: SectionPanel) => {
      if (panel === next) closePanel()
      else openPanel(next)
    },
    [panel, openPanel, closePanel]
  )

  const startEdit = useCallback((id: string) => {
    writeQuery({ [EDIT_KEY]: id, [OPEN_KEY]: null }, 'push')
  }, [])

  const stopEdit = useCallback(() => {
    writeQuery({ [EDIT_KEY]: null }, 'replace')
  }, [])

  return { panel, editId, openPanel, togglePanel, closePanel, startEdit, stopEdit }
}
