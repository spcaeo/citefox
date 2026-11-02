import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SIDEBAR_MODE, SIDEBAR_AUTO_COLLAPSE_WIDTH, type SidebarMode } from '@shared/domain'
import { useLatest } from '../components/useLatest'

/** True when the sidebar shows as the 64px icon rail. */
export function isSidebarCollapsed(mode: SidebarMode, narrow: boolean): boolean {
  return mode === 'collapsed' || (mode === 'auto' && narrow)
}

/**
 * The mode a toggle saves. Collapsing is always the person's choice. Expanding
 * a wide window goes back to `auto` (so it folds again when the window gets
 * narrow); expanding a narrow window pins it open.
 */
export function nextSidebarMode(mode: SidebarMode, narrow: boolean): SidebarMode {
  if (!isSidebarCollapsed(mode, narrow)) return 'collapsed'
  return narrow ? 'expanded' : 'auto'
}

/** Cmd+B (macOS) or Ctrl+B, outside text fields. */
export function isSidebarShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 'b' || event.altKey || event.shiftKey) return false
  if (!(event.metaKey || event.ctrlKey)) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target.isContentEditable) return false
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const NARROW_QUERY = `(max-width: ${SIDEBAR_AUTO_COLLAPSE_WIDTH - 0.02}px)`

function readNarrow(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') return window.matchMedia(NARROW_QUERY).matches
  return window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH
}

export interface SidebarState {
  collapsed: boolean
  mode: SidebarMode
  /** The window is under the auto-collapse width. */
  narrow: boolean
  toggle: () => void
}

/**
 * The sidebar's collapsed state. `stored` is `settings.sidebar` from
 * `settings:get` (undefined until it loads); `save` writes a new choice with
 * `settings:update`, so it holds across restarts. The toggle applies at once
 * and does not wait for the write.
 */
export function useSidebar(
  stored: SidebarMode | undefined,
  save: (mode: SidebarMode) => Promise<unknown>
): SidebarState {
  const [chosen, setChosen] = useState<SidebarMode | null>(null)
  const [narrow, setNarrow] = useState(readNarrow)
  const mode = chosen ?? stored ?? DEFAULT_SIDEBAR_MODE
  const latest = useLatest({ mode, narrow, save })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      const onResize = (): void => setNarrow(readNarrow())
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const query = window.matchMedia(NARROW_QUERY)
    const onChange = (): void => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    const { mode: current, narrow: isNarrow, save: write } = latest.current
    const next = nextSidebarMode(current, isNarrow)
    setChosen(next)
    void write(next).catch(() => {
      // The choice still applies for this session; the next toggle tries again.
    })
  }, [latest])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!isSidebarShortcut(event)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return { collapsed: isSidebarCollapsed(mode, narrow), mode, narrow, toggle }
}
