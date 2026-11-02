import { useMemo, type JSX } from 'react'
import type { HelpFillBot, HelpFillWay } from '../ui'
import { AddMarketDrawer } from './AddMarketDrawer'
import { createProjectMarketsSource } from './source'

/** The window-wide Add market drawer on the preload bridge (shell/DrawerHost). */
export function AddMarketHost({
  projectId,
  pageId,
  help,
  bot,
  onHelp,
  onBot,
  onClose
}: {
  projectId: string
  pageId: string | null
  /** ✦ Help me fill this: `am.help=` and `am.bot=` on the drawer's URL. */
  help: HelpFillWay | null
  bot: HelpFillBot | null
  onHelp: (way: HelpFillWay) => void
  onBot: (bot: HelpFillBot) => void
  onClose: (marketId?: string) => void
}): JSX.Element {
  const source = useMemo(() => createProjectMarketsSource(), [])
  return (
    <AddMarketDrawer
      source={source}
      projectId={projectId}
      pageId={pageId}
      help={{ way: help, onWay: onHelp, bot, onBot }}
      onClose={onClose}
    />
  )
}
