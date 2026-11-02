import { parseSetupHash, stepHash } from '../../onboarding/setupSteps'
import { sectionHash } from '../../shell/routes'

/** Screen names Claude's stop messages send people to. */
export const SCREEN_NAMES = /(Connections and keys|Settings › Connections)/

export type ScreenName = 'Connections and keys' | 'Settings › Connections'

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/**
 * The link for a screen a message names. During setup the app's screens are not
 * open yet, so both go to setup's "Connect Claude" step, which takes an API key too.
 */
export function screenHash(name: ScreenName, hash: string = currentHash()): string {
  if (parseSetupHash(hash) !== null) return stepHash('claude')
  return name === 'Settings › Connections'
    ? `${sectionHash('settings')}?tab=connections`
    : sectionHash('connections')
}

/** Where "Use an API key instead" goes. */
export function apiKeyHash(hash: string = currentHash()): string {
  return screenHash('Connections and keys', hash)
}
