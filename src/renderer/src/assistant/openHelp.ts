import { HELP_TOPIC_TITLES, isHelpTopicId } from '@shared/help-topics'
import { isDrawerId } from '../shell/drawerUrl'
import { openDrawer } from '../shell/drawers'
import { SECTIONS, sectionHash } from '../shell/routes'

/**
 * Ask CiteFox's links into the help: "Read more: <title>" opens the help
 * drawer on that topic (`drawer=help&help.id=<id>`), and a next step opens a
 * screen. The help drawer is the Help builder's; until it is registered in
 * DRAWER_KINDS, `helpDrawerReady()` is false and the drawer shows the topic
 * title without a link, so nothing points at a drawer that does not exist.
 */

const HELP_DRAWER: string = 'help'

export function helpDrawerReady(): boolean {
  return isDrawerId(HELP_DRAWER)
}

/** Opens the help drawer over the current screen on topic `id`. */
export function openHelp(id: string): void {
  const kind = HELP_DRAWER
  if (isDrawerId(kind)) openDrawer(kind, { 'help.id': id })
}

/** The topic's title: the loaded file's title from main, else the shipped name. */
export function helpTitle(id: string, given?: string): string {
  if (given && given.trim() !== '') return given
  return isHelpTopicId(id) ? HELP_TOPIC_TITLES[id] : id
}

/** The hash for a next step's section, or null for a section this app does not have. */
export function nextStepHref(section: string): string | null {
  const found = SECTIONS.find((item) => item.id === section)
  return found ? sectionHash(found.id) : null
}
