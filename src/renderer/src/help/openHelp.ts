import type { HelpTopicId } from '@shared/help'
import { withDrawerOpened } from '../shell/drawerUrl'

/**
 * The drawer that shows one help topic: `drawer=help&help.id=<id>` (shell/drawerUrl).
 * `openHelp(id)` is Ask CiteFox's (assistant/openHelp), the one function every caller
 * uses (the Guide, Ask, Ctrl+K); it works now that the `help` drawer is registered.
 */
export const HELP_DRAWER = 'help'
export const HELP_ID_PARAM = 'help.id'

export { openHelp } from '../assistant/openHelp'

/** The link that opens help topic `id` over `hash` (default: the screen open now). */
export function helpHref(id: HelpTopicId | string, hash?: string): string {
  const here = hash ?? (typeof window === 'undefined' ? '' : window.location.hash)
  return withDrawerOpened(here, HELP_DRAWER, { [HELP_ID_PARAM]: id })
}
