import { createContext, useContext } from 'react'

/**
 * Goes up each time the shell reloads after a pushed `checks:finished` or
 * `queue:status`. Screens that load their own data list it as an effect
 * dependency so they reload in place too.
 */
export const EngineRevisionContext = createContext(0)

export function useEngineRevision(): number {
  return useContext(EngineRevisionContext)
}
