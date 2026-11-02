import { useCallback, useState } from 'react'
import {
  DEFAULT_GROUP_STATE,
  parseGroupState,
  type SidebarGroupId,
  type SidebarGroupState
} from './sidebarNav'

const KEY = 'citefox.sidebarGroups.'

function storageKey(projectId: string | null): string {
  return KEY + (projectId ?? 'none')
}

/** The folded and open groups saved for a project. Missing or blocked storage gives the defaults. */
export function readGroupState(projectId: string | null): SidebarGroupState {
  try {
    return parseGroupState(window.localStorage.getItem(storageKey(projectId)))
  } catch {
    return DEFAULT_GROUP_STATE
  }
}

export function saveGroupState(projectId: string | null, state: SidebarGroupState): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(state))
  } catch {
    // Storage blocked: the choice holds for this window only.
  }
}

export interface SidebarGroups {
  /** True when the group shows its items. */
  isOpen: (group: SidebarGroupId) => boolean
  toggle: (group: SidebarGroupId) => void
}

/**
 * Which sidebar groups are open, remembered per project in this window's
 * storage (a preference, not part of the URL). `current` is the group that
 * holds the open route: when it is folded it shows anyway until the route
 * leaves it or the user folds it again, so the open screen is never hidden.
 */
export function useSidebarGroups(
  projectId: string | null,
  current: SidebarGroupId | null
): SidebarGroups {
  const [loaded, setLoaded] = useState<{ projectId: string | null; state: SidebarGroupState }>(
    () => ({ projectId, state: readGroupState(projectId) })
  )
  const [revealed, setRevealed] = useState<SidebarGroupId | null>(null)
  const [seen, setSeen] = useState<{ projectId: string | null; current: SidebarGroupId | null }>({
    projectId,
    current: null
  })

  // Adjusted while rendering, not in an effect: a project switch reads that
  // project's choice, and a route into a folded group reveals the group.
  let state = loaded.state
  if (loaded.projectId !== projectId) {
    state = readGroupState(projectId)
    setLoaded({ projectId, state })
  }
  if (seen.projectId !== projectId || seen.current !== current) {
    setSeen({ projectId, current })
    setRevealed(current !== null && !state[current] ? current : null)
  }

  const isOpen = useCallback(
    (group: SidebarGroupId) => state[group] || revealed === group,
    [state, revealed]
  )

  const toggle = useCallback(
    (group: SidebarGroupId) => {
      const open = state[group] || revealed === group
      const next = { ...state, [group]: !open }
      if (revealed === group) setRevealed(null)
      setLoaded({ projectId, state: next })
      saveGroupState(projectId, next)
    },
    [state, revealed, projectId]
  )

  return { isOpen, toggle }
}
