import { join, resolve } from 'node:path'

/** Files CiteFox keeps in Electron's `userData` directory (SRS section 9.2). */
export interface AppDataPaths {
  root: string
  appDatabase: string
  settingsFile: string
  projectsDirectory: string
  /** Last window bounds. Not a setting and not a secret. */
  windowStateFile: string
  /** An unfinished onboarding's step and typed fields. Never a secret. */
  onboardingDraftFile: string
}

/**
 * Something that can answer `getPath('userData')`. Production passes Electron's
 * `app` after `app.setName('CiteFox')`. Tests pass a fake and a temp directory.
 */
export interface UserDataPathSource {
  getPath(name: 'userData'): string
}

export function appDataPaths(userData: string): AppDataPaths {
  const root = resolve(userData)
  return {
    root,
    appDatabase: join(root, 'app.sqlite'),
    settingsFile: join(root, 'settings.json'),
    projectsDirectory: join(root, 'projects'),
    windowStateFile: join(root, 'window-state.json'),
    onboardingDraftFile: join(root, 'onboarding-draft.json')
  }
}

export function appDataPathsFrom(source: UserDataPathSource): AppDataPaths {
  return appDataPaths(source.getPath('userData'))
}
