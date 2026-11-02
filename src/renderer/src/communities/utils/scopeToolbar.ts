import { createContext, useContext, type ReactNode } from 'react'

const ScopeToolbarContext = createContext<ReactNode>(null)

/** Gives the screen's scope filters to the grids below, which put them in their toolbar. */
export const ScopeToolbarProvider = ScopeToolbarContext.Provider

/** The filters for a grid's toolbar (null outside the screen, such as in tests of one grid). */
export function useScopeToolbar(): ReactNode {
  return useContext(ScopeToolbarContext)
}
