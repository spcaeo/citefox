import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import type { ProjectRecord } from '../../storage/records'
import { scorePass, type ScorePass } from '../checks/glance'
import type { EngineHost } from '../host'
import { withProject } from '../project-db'

/** One All pages call: the project, its open file, and the score pass. */
export interface AllPagesPass {
  storage: AppStorage
  project: ProjectRecord
  db: SqliteDatabase
  scorePass: ScorePass
  now: Date
}

export function withAllPages<T>(
  host: EngineHost,
  projectId: string,
  channel: string,
  run: (pass: AllPagesPass) => T | Promise<T>
): Promise<T> {
  return withProject(host, projectId, channel, (opened) => {
    const now = host.now()
    return run({
      storage: host.storage,
      project: opened.project,
      db: opened.db,
      scorePass: scorePass(host.storage, now, systemTimeZone()),
      now
    })
  })
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
