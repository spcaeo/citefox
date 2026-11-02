import { openDrawer, type OpenDrawerOptions } from '../shell/drawers'

// The domain a new type is for travels to the drawer here, not on the URL: drawer
// values are opaque ids only (shell/drawerUrl.ts).
let pendingDomain: string | null = null

/**
 * Opens Types of site. With `create`, it opens on a new type; with a `domain` too,
 * the new type is for that site and the drawer closes with the type's id.
 */
export function openSiteTypes(
  { create = false, domain }: { create?: boolean; domain?: string } = {},
  options: OpenDrawerOptions = {}
): void {
  pendingDomain = create ? (domain ?? null) : null
  openDrawer('site-types', create ? { 'st.new': '1' } : {}, options)
}

/** The domain handed over by {@link openSiteTypes}, once. */
export function takeSiteTypesDomain(): string | null {
  const domain = pendingDomain
  pendingDomain = null
  return domain
}
