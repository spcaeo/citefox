import { createContext, useContext } from 'react'
import type { GuideApi } from './hooks/useGuide'
import type { GuideScreen } from './types'

/** The guide and the "What is this page?" card the "?" reopens. */
export interface GuideContextValue {
  api: GuideApi
  /** The "?" in the top bar: show this screen's explainer again. */
  openExplainer: () => void
  /** The screen whose explainer the "?" opened, until it is closed or the screen changes. */
  forced: GuideScreen | null
  closeExplainer: () => void
}

export const GuideContext = createContext<GuideContextValue | null>(null)

/** The guide, or null outside the app shell (tests, harness pages). */
export function useGuideContext(): GuideContextValue | null {
  return useContext(GuideContext)
}
