import { useCallback } from 'react'
import { botParam, type HelpFillBot } from '../../ui'
import { useQueryState } from '../../utils/queryState'

/** The three ways to set a new project up (HelpFill.dc.html panel 4). */
export const SETUP_WAYS = ['website', 'chatbot', 'form'] as const
export type SetupWay = (typeof SETUP_WAYS)[number]

export function setupWayParam(value: string | null | undefined): SetupWay | null {
  return (SETUP_WAYS as readonly string[]).includes(value ?? '') ? (value as SetupWay) : null
}

export interface SetupUrlState {
  way: SetupWay | null
  onWay: (way: SetupWay) => void
  bot: HelpFillBot | null
  onBot: (bot: HelpFillBot) => void
}

/**
 * `help=website|chatbot|form` and `bot=` on the screen's query, like the helper
 * everywhere else: picking a way is a history entry (Back returns to the other
 * way), picking a bot rewrites the entry in place.
 */
export function useSetupUrl(): SetupUrlState {
  const [way, setWay] = useQueryState('help', { history: 'push' })
  const [bot, setBot] = useQueryState('bot')
  const onWay = useCallback((next: SetupWay) => setWay(next), [setWay])
  const onBot = useCallback((next: HelpFillBot) => setBot(next), [setBot])
  return { way: setupWayParam(way), onWay, bot: botParam(bot), onBot }
}
