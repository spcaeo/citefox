import { sectionHash, startHash } from '../shell/routes'

/**
 * How the user chose to start a project (owner feedback 6): CiteFox sets the
 * site up (`autopilot`) or the user picks what to track (`self`). Remembered
 * per project in this window's storage; a missing or blocked storage simply
 * means "not chosen yet".
 */
export type StartChoice = 'autopilot' | 'self'

const KEY = 'citefox.startChoice.'

export function readStartChoice(projectId: string): StartChoice | null {
  try {
    const value = window.localStorage.getItem(KEY + projectId)
    return value === 'autopilot' || value === 'self' ? value : null
  } catch {
    return null
  }
}

export function saveStartChoice(projectId: string, choice: StartChoice): void {
  try {
    window.localStorage.setItem(KEY + projectId, choice)
  } catch {
    // Storage blocked: the choice screen shows again next time.
  }
}

/** Where finishing onboarding goes: the choice screen, never straight into setup. */
export function afterOnboardingHash(): string {
  return startHash('choose')
}

/**
 * Where an empty project lands: the running setup when it runs, otherwise the
 * remembered choice (autopilot → the journey, self → the chooser), and the
 * choice screen when nothing was chosen yet.
 */
export function emptyProjectHash(choice: StartChoice | null, running: boolean): string {
  if (running) return startHash('setup')
  if (choice === 'autopilot') return startHash()
  if (choice === 'self') return sectionHash('add')
  return startHash('choose')
}
