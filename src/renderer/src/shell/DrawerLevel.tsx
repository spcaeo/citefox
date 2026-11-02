import { useContext, useMemo, type JSX, type ReactNode } from 'react'
import { DrawerLevelContext, type DrawerLevelValue } from '../ui'
import { DrawerTrailContext, drawerLevelCrumbs } from './drawerCrumbs'
import { screenHash } from './drawerUrl'
import { navigateHash } from './routes'
import {
  closeAllDrawers,
  closeDrawer,
  closeDrawersThen,
  registerDrawerGuard,
  useDrawerStack
} from './drawers'

/**
 * Tells the Drawer inside it where it sits in the URL's stack: its depth (a
 * stacked drawer is narrower), the crumbs before its own, crumbs that close
 * the drawers before navigating, and its unsaved-changes guard for Back.
 * Wrap every drawer that is opened with `openDrawer` in one.
 */
export function DrawerLevel({
  depth,
  children
}: {
  depth: number
  children: ReactNode
}): JSX.Element {
  const route = useContext(DrawerTrailContext)
  const { stack, hash } = useDrawerStack()
  const screen = screenHash(hash)
  const value = useMemo<DrawerLevelValue>(
    () => ({
      depth,
      crumbs: drawerLevelCrumbs(route, screen, stack, depth, {
        closeAll: closeAllDrawers,
        closeFrom: (from) => closeDrawer(from)
      }),
      navigate: closeDrawersThen,
      registerGuard: (guard) => registerDrawerGuard(depth, guard)
    }),
    [route, screen, stack, depth]
  )
  return <DrawerLevelContext.Provider value={value}>{children}</DrawerLevelContext.Provider>
}

/**
 * For a drawer a screen keeps in its own state or its own URL value (Check
 * history's `?compare=`, a local count list) rather than on the drawer stack:
 * the route's trail as crumbs, the screen's crumb closes the drawer, and the
 * other crumbs navigate (the route change closes it).
 */
export function ScreenDrawerLevel({
  onClose,
  children
}: {
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const route = useContext(DrawerTrailContext)
  const value = useMemo<DrawerLevelValue>(
    () => ({
      depth: 0,
      crumbs: route.map((item) =>
        item.screen
          ? { label: item.label, href: item.href, onSelect: onClose }
          : { label: item.label, href: item.href }
      ),
      navigate: navigateHash
    }),
    [route, onClose]
  )
  return <DrawerLevelContext.Provider value={value}>{children}</DrawerLevelContext.Provider>
}
