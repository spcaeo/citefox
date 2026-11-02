import { createContext, useContext } from 'react'
import type { OnboardingClient } from '../onboarding/client'

/** The calls the build menu makes. The shell and onboarding clients (and their mocks) have them. */
export type BuildClient = Pick<OnboardingClient, 'getInfo' | 'resetKeepKeys' | 'openTestProfile'>

export type BuildNoticeTone = 'ok' | 'bad'

/** A link at the end of a toast, such as "View them" after + Add → Questions. */
export interface BuildNoticeLink {
  label: string
  href: string
}

/** A button in a toast, such as "Undo" after an import. The toast closes when it is pressed. */
export interface BuildNoticeAction {
  label: string
  onClick: () => void
}

export interface BuildTools {
  client: BuildClient
  /**
   * Shows a short result line ("Test window opened") in the window's one toast, with an
   * optional link and an optional action button (a toast with an action stays longer).
   */
  notify: (
    message: string,
    tone?: BuildNoticeTone,
    link?: BuildNoticeLink,
    action?: BuildNoticeAction
  ) => void
}

function bridge(): NonNullable<Window['citefox']> {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** The preload bridge, read on each call (used when no host provides a client). */
export const ipcBuildClient: BuildClient = {
  getInfo: async () => bridge()['app:getInfo'](),
  resetKeepKeys: async () => bridge()['app:resetKeepKeys'](),
  openTestProfile: async (request) => bridge()['app:openTestProfile'](request)
}

const fallbackTools: BuildTools = { client: ipcBuildClient, notify: () => undefined }

export const BuildToolsContext = createContext<BuildTools>(fallbackTools)

/** The build client and the toast of the nearest `BuildToolsHost`. */
export function useBuildTools(): BuildTools {
  return useContext(BuildToolsContext)
}
