import type { GroupSummary } from '@shared/domain'
import type {
  CreateGroupRequest,
  GroupIdRequest,
  GroupPageList,
  RenameGroupRequest,
  SetGroupPagesRequest,
  StructureView
} from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import {
  changeGroupPages,
  deleteGroup as deleteStoredGroup,
  getGroup,
  insertGroup,
  listGroups,
  updateGroup
} from '../storage/group-records'
import type { StructureRuntime } from './runtime'
import { viewContext } from './service-structure'
import { buildStructureView, loadStructureData, summarizeGroup } from './view'

/**
 * FR-19.7 groups: user-made lists. Only these user requests write groups;
 * clustering and Claude never do. A page may be in any number of groups.
 */

export function createGroup(
  rt: StructureRuntime,
  request: CreateGroupRequest
): Promise<GroupSummary> {
  const channel = 'structure:createGroup'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const name = request.name.trim()
    if (listGroups(opened.db).some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      throw new IpcRequestError(channel, 'A group with this name already exists.')
    }
    const id = `group-${rt.host.createId()}`
    insertGroup(opened.db, { id, name, note: request.note, createdAt: rt.host.now().toISOString() })
    return summary(opened.db, id, channel)
  })
}

export function renameGroup(
  rt: StructureRuntime,
  request: RenameGroupRequest
): Promise<GroupSummary> {
  const channel = 'structure:renameGroup'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    requireGroup(opened.db, request.groupId, channel)
    updateGroup(opened.db, request.groupId, { name: request.name, note: request.note })
    return summary(opened.db, request.groupId, channel)
  })
}

export function deleteGroup(rt: StructureRuntime, request: GroupIdRequest): Promise<StructureView> {
  const channel = 'structure:deleteGroup'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    requireGroup(opened.db, request.groupId, channel)
    deleteStoredGroup(opened.db, request.groupId)
    return buildStructureView(viewContext(rt, opened))
  })
}

/** Unknown or removed page ids are ignored, so a stale selection cannot fail the whole change. */
export function setGroupPages(
  rt: StructureRuntime,
  request: SetGroupPagesRequest
): Promise<GroupSummary> {
  const channel = 'structure:setGroupPages'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    requireGroup(opened.db, request.groupId, channel)
    const data = loadStructureData(opened.db)
    const add = request.add.filter((id) => data.byId.has(id))
    changeGroupPages(opened.db, request.groupId, add, request.remove, rt.host.now().toISOString())
    return summary(opened.db, request.groupId, channel)
  })
}

export function groupPages(rt: StructureRuntime, request: GroupIdRequest): Promise<GroupPageList> {
  const channel = 'structure:groupPages'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const group = requireGroup(opened.db, request.groupId, channel)
    const data = loadStructureData(opened.db)
    return {
      groupId: group.id,
      pages: group.pageIds.flatMap((id) => {
        const page = data.byId.get(id)
        return page === undefined
          ? []
          : [
              {
                pageId: page.id,
                url: page.url,
                title: page.title,
                status: page.status,
                score: page.score
              }
            ]
      })
    }
  })
}

function requireGroup(
  db: Parameters<typeof getGroup>[0],
  id: string,
  channel: string
): NonNullable<ReturnType<typeof getGroup>> {
  const group = getGroup(db, id)
  if (group === null) throw new IpcRequestError(channel, 'That group was not found.')
  return group
}

function summary(db: Parameters<typeof getGroup>[0], id: string, channel: string): GroupSummary {
  const group = requireGroup(db, id, channel)
  return summarizeGroup(loadStructureData(db), group)
}
