import type {
  CreateTopicFolderRequest,
  DeleteTopicFolderRequest,
  MoveTopicsToFolderRequest,
  RenameTopicFolderRequest,
  TopicFolderList
} from '@shared/ipc'
import type { EngineHost } from '../../engine/host'
import { IpcRequestError } from '../../ipc-request'
import { StorageError } from '../../storage/errors'
import {
  deleteTopicFolder,
  insertTopicFolder,
  listTopicFolders,
  moveTopicsToFolder,
  renameTopicFolder
} from '../../storage/topic-folders'
import { TopicInputError } from '../drafts'
import type { OpenedProject } from '../env'
import { id, parseIds, projectRequest, record, text } from '../parse'

/**
 * Topic folders (migration 050): parse each request, change the folders, answer with
 * the whole list. A storage refusal (a taken name, an unknown folder) becomes a
 * plain-words error the screen shows as it is.
 */

export function readTopicFolders(opened: OpenedProject): TopicFolderList {
  const { folders, placement } = listTopicFolders(opened.db)
  const members = new Map<string, string[]>()
  for (const [topicId, folderId] of Object.entries(placement)) {
    const list = members.get(folderId) ?? []
    list.push(topicId)
    members.set(folderId, list)
  }
  return {
    projectId: opened.project.id,
    folders: folders.map((folder) => ({ ...folder, topicIds: members.get(folder.id) ?? [] }))
  }
}

function plainWords<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof StorageError) throw new TopicInputError(error.message)
    throw error
  }
}

export function parseFoldersRequest(value: unknown): { projectId: string } {
  return projectRequest(value, 'topics:folders')
}

export function parseCreateFolder(value: unknown): CreateTopicFolderRequest {
  const channel = 'topics:createFolder'
  const raw = record(value, channel)
  return {
    projectId: id(raw, 'projectId', channel),
    name: text(raw, 'name', channel, 200, false),
    topicIds: raw.topicIds === undefined ? [] : parseIds(raw.topicIds, channel)
  }
}

export function parseRenameFolder(value: unknown): RenameTopicFolderRequest {
  const channel = 'topics:renameFolder'
  const raw = record(value, channel)
  return {
    projectId: id(raw, 'projectId', channel),
    folderId: id(raw, 'folderId', channel),
    name: text(raw, 'name', channel, 200, false)
  }
}

export function parseDeleteFolder(value: unknown): DeleteTopicFolderRequest {
  const channel = 'topics:deleteFolder'
  const raw = record(value, channel)
  return { projectId: id(raw, 'projectId', channel), folderId: id(raw, 'folderId', channel) }
}

export function parseMoveToFolder(value: unknown): MoveTopicsToFolderRequest {
  const channel = 'topics:moveToFolder'
  const raw = record(value, channel)
  const topicIds = parseIds(raw.topicIds, channel)
  if (topicIds.length === 0) throw new IpcRequestError(channel)
  if (raw.folderId !== null && typeof raw.folderId !== 'string') throw new IpcRequestError(channel)
  return {
    projectId: id(raw, 'projectId', channel),
    topicIds,
    folderId: raw.folderId === null ? null : id(raw, 'folderId', channel)
  }
}

export function createTopicFolder(
  host: Pick<EngineHost, 'now' | 'createId'>,
  opened: OpenedProject,
  request: CreateTopicFolderRequest
): TopicFolderList {
  plainWords(() =>
    opened.db.transaction(() => {
      const folderId = host.createId()
      insertTopicFolder(opened.db, {
        id: folderId,
        name: request.name,
        createdAt: host.now().toISOString()
      })
      if (request.topicIds && request.topicIds.length > 0)
        moveTopicsToFolder(opened.db, request.topicIds, folderId)
    })()
  )
  return readTopicFolders(opened)
}

export function renameFolder(
  opened: OpenedProject,
  request: RenameTopicFolderRequest
): TopicFolderList {
  plainWords(() => renameTopicFolder(opened.db, request.folderId, request.name))
  return readTopicFolders(opened)
}

export function deleteFolder(
  opened: OpenedProject,
  request: DeleteTopicFolderRequest
): TopicFolderList {
  plainWords(() => deleteTopicFolder(opened.db, request.folderId))
  return readTopicFolders(opened)
}

export function moveToFolder(
  opened: OpenedProject,
  request: MoveTopicsToFolderRequest
): TopicFolderList {
  plainWords(() => moveTopicsToFolder(opened.db, request.topicIds, request.folderId))
  return readTopicFolders(opened)
}
