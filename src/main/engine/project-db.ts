import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import { StorageError } from '../storage/errors'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject, type ProjectRecord } from '../storage/records'
import type { EngineHost } from './host'

export interface OpenProject {
  project: ProjectRecord
  db: SqliteDatabase
  close: () => void
}

/** Opens the project file for one handler call and closes it afterwards. */
export function openOwned(host: EngineHost, projectId: string, channel: string): OpenProject {
  const project = getProject(host.storage.db, projectId)
  if (project === null) throw new IpcRequestError(channel, 'That project was not found')
  let db: SqliteDatabase
  try {
    db = openProjectDatabase(host.storage.paths.projectsDirectory, project.slug)
  } catch (error) {
    if (error instanceof StorageError) {
      throw new IpcRequestError(channel, 'That project was not found')
    }
    throw error
  }
  return {
    project,
    db,
    close: () => {
      closeProjectDatabase(db)
    }
  }
}

export async function withProject<T>(
  host: EngineHost,
  projectId: string,
  channel: string,
  run: (opened: OpenProject) => Promise<T> | T
): Promise<T> {
  const opened = openOwned(host, projectId, channel)
  try {
    return await run(opened)
  } finally {
    opened.close()
  }
}
