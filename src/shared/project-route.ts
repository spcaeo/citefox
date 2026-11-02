/**
 * Project-qualified routes: `#/p/<projectId>/<route>`. Page and section routes
 * read the open project, so a link to something in another project names its
 * project. The window switches to that project, then opens `<route>` (the
 * shell replaces the hash with the plain route once the switch is done).
 * Shared so the tray (main) and the window build the same form.
 */

const PREFIX = /^#?\/?p\/([^/?#]+)(.*)$/

/** `hash` (with or without `#`) in project `projectId`. */
export function projectRouteHash(projectId: string, hash: string): string {
  const bare = hash.startsWith('#') ? hash.slice(1) : hash
  const path = bare.startsWith('/') ? bare : `/${bare}`
  return `#/p/${encodeURIComponent(projectId)}${path}`
}

/**
 * The project a hash names and the plain hash it opens there. A hash without
 * the prefix (or with an id that cannot be decoded) comes back unchanged with
 * `projectId: null`.
 */
export function splitProjectRoute(hash: string): { projectId: string | null; hash: string } {
  const match = PREFIX.exec(hash)
  if (!match) return { projectId: null, hash }
  const [, raw = '', rest = ''] = match
  let projectId: string
  try {
    projectId = decodeURIComponent(raw)
  } catch {
    return { projectId: null, hash }
  }
  if (projectId.length === 0) return { projectId: null, hash }
  const path = rest.startsWith('/') ? rest : `/${rest}`
  return { projectId, hash: `#${path}` }
}
