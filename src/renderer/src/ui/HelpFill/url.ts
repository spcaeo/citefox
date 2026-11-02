import { useCallback } from 'react'
import { isHelpFillBot, isHelpFillWay, type HelpFillBot, type HelpFillWay } from '@shared/helpfill'
import { useQueryState } from '../../utils/queryState'

/** Where the last picked chatbot is kept for this person (a convenience; the URL wins). */
const BOT_KEY = 'citefox.helpfill.bot'

/** The chatbot this person picked last, or null. */
export function rememberedBot(): HelpFillBot | null {
  try {
    const value = window.localStorage.getItem(BOT_KEY)
    return isHelpFillBot(value) ? value : null
  } catch {
    return null
  }
}

export function rememberBot(bot: HelpFillBot): void {
  try {
    window.localStorage.setItem(BOT_KEY, bot)
  } catch {
    // Private window or blocked storage: the URL still carries the pick.
  }
}

/** A URL value as a way, or null. */
export function wayParam(value: string | null | undefined): HelpFillWay | null {
  return isHelpFillWay(value) ? value : null
}

/** A URL value as a bot, or null. */
export function botParam(value: string | null | undefined): HelpFillBot | null {
  return isHelpFillBot(value) ? value : null
}

export interface HelpFillUrlState {
  way: HelpFillWay | null
  onWay: (way: HelpFillWay) => void
  bot: HelpFillBot | null
  onBot: (bot: HelpFillBot) => void
}

/**
 * `help=` and `bot=` on a screen's own query, for a helper that is not inside a
 * drawer (a drawer passes its own params instead: `setDrawerParams`). Picking a
 * way is a history entry, so Back returns to the other way; picking a bot
 * rewrites the entry in place. `prefix` keeps two helpers on one screen apart
 * (`comp.help=`).
 */
export function useHelpFillUrl(prefix = ''): HelpFillUrlState {
  const [way, setWay] = useQueryState(`${prefix}help`, { history: 'push' })
  const [bot, setBot] = useQueryState(`${prefix}bot`)
  const onWay = useCallback((next: HelpFillWay) => setWay(next), [setWay])
  const onBot = useCallback((next: HelpFillBot) => setBot(next), [setBot])
  return { way: wayParam(way), onWay, bot: botParam(bot), onBot }
}
