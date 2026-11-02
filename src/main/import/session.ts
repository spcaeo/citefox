import type { ImportEntity, ImportFileKind } from '@shared/ipc'
import type { ImportTable } from './table'

/**
 * What an import keeps between calls, in memory only: the files the open dialog
 * picked (a token stands for the path, which never reaches the renderer) and the
 * tables read from them or from a paste. Both expire; nothing is written to disk.
 */

/** How long a picked file can be read (switching sheets reads it again). */
export const FILE_TTL_MS = 10 * 60 * 1000
/** How long a read table is kept for the column match and the preview. */
export const SOURCE_TTL_MS = 30 * 60 * 1000
/** Tables kept at once; the oldest goes first. */
const MAX_SOURCES = 12

export interface PickedFile {
  path: string
  name: string
  bytes: number
  kind: ImportFileKind
  entity: ImportEntity
  at: number
}

export interface ReadSource {
  projectId: string
  entity: ImportEntity
  name: string
  table: ImportTable
  signature: string
  at: number
}

export interface ImportSession {
  addFile: (file: Omit<PickedFile, 'at'>) => string
  file: (token: string) => PickedFile | null
  addSource: (source: Omit<ReadSource, 'at'>) => string
  source: (sourceId: string) => ReadSource | null
}

export function createImportSession(deps: {
  now: () => Date
  createId: () => string
}): ImportSession {
  const files = new Map<string, PickedFile>()
  const sources = new Map<string, ReadSource>()
  const sweep = (): void => {
    const now = deps.now().getTime()
    for (const [token, file] of files) if (now - file.at > FILE_TTL_MS) files.delete(token)
    for (const [id, source] of sources) if (now - source.at > SOURCE_TTL_MS) sources.delete(id)
  }
  return {
    addFile(file) {
      sweep()
      const token = `file-${deps.createId()}`
      files.set(token, { ...file, at: deps.now().getTime() })
      return token
    },
    file(token) {
      sweep()
      return files.get(token) ?? null
    },
    addSource(source) {
      sweep()
      const id = `src-${deps.createId()}`
      sources.set(id, { ...source, at: deps.now().getTime() })
      while (sources.size > MAX_SOURCES) {
        const oldest = sources.keys().next().value
        if (oldest === undefined) break
        sources.delete(oldest)
      }
      return id
    },
    source(sourceId) {
      sweep()
      return sources.get(sourceId) ?? null
    }
  }
}
