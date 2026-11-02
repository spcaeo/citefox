import { createContext, useContext } from 'react'
import type { DrillRequest } from './types'

export interface DrillApi {
  /** Opens the drawer for this request, replacing any open one. */
  open: (drill: DrillRequest) => void
  close: () => void
  /** The open request, or null. */
  current: DrillRequest | null
  /**
   * Tells the host what a number on screen opens, so a copied link
   * (`drawer=drill&drill=<id>`) reopens that list. DrillNumber and
   * DrillButton call it; a screen that opens drills another way can too.
   */
  register: (drill: DrillRequest) => void
}

export const DrillContext = createContext<DrillApi | null>(null)

/** The nearest drill host. Throws outside one: wrap the screen in `<DrillHost>`. */
export function useDrill(): DrillApi {
  const api = useContext(DrillContext)
  if (!api) throw new Error('useDrill needs a <DrillHost> above it.')
  return api
}
