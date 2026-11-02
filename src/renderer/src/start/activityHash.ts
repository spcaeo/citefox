import { drawerStack, withDrawerOpened } from '../shell/drawerUrl'

/** The Activity drawer is on the drawer stack (`drawer=activity`, Docs/DRAWER.md). */

/** True when the hash opens the Activity drawer. */
export function activityOpenIn(hash: string): boolean {
  return drawerStack(hash).some((entry) => entry.id === 'activity')
}

/** The link that opens the Activity drawer over `hash`, its other values kept. */
export function activityHref(hash: string): string {
  return withDrawerOpened(hash, 'activity')
}
