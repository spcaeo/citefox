import { existsSync } from 'node:fs'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import { getProjectBySlug } from '../storage/records'
import { isSafeProjectSlug, projectDatabasePath, slugFromLabel } from '../storage/slug'

/** Picks a free `projects/<slug>.sqlite` name. The caller names the channel on failure. */
export function allocateProjectSlug(
  db: SqliteDatabase,
  projectsDirectory: string,
  name: string,
  domain: string,
  channel: string
): string {
  const label = domain.split('.')[0] ?? ''
  const base = slugFromLabel(name) ?? slugFromLabel(label) ?? 'project'
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const suffix = attempt === 1 ? '' : `-${attempt}`
    const room = 64 - suffix.length
    const candidate = `${base.slice(0, room)}${suffix}`.replace(/-+$/g, '')
    if (!isSafeProjectSlug(candidate)) continue
    if (getProjectBySlug(db, candidate) !== null) continue
    const file = projectDatabasePath(projectsDirectory, candidate)
    if (existsSync(file)) continue
    return candidate
  }
  throw new IpcRequestError(channel, 'Could not save the project')
}
