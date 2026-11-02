import { createContext, useContext } from 'react'
import type { DrawerCrumb } from './types'

/**
 * What the router (shell/DrawerLevel) tells a drawer about its place: how deep
 * it is, the crumbs before its own, how a crumb navigates, and where its
 * unsaved-changes guard goes so browser Back asks too. A drawer used outside
 * the router (a screen's own state) gets none of this and still works.
 */
export interface DrawerLevelValue {
  depth: number
  crumbs: readonly DrawerCrumb[]
  /** Opens an in-app hash from a crumb; the router closes the drawers first. */
  navigate?: (href: string) => void
  registerGuard?: (guard: { dirty: boolean; ask: () => void }) => () => void
}

export const DrawerLevelContext = createContext<DrawerLevelValue | null>(null)

export function useDrawerLevel(): DrawerLevelValue | null {
  return useContext(DrawerLevelContext)
}

/** The open drawer's id, so Expert options remember their state per drawer. */
export const DrawerIdContext = createContext<string | null>(null)
