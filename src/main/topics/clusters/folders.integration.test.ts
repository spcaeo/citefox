import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed } from '../../engine/checks/checks.test-helper'
import { getProject } from '../../storage/records'
import { seedTextboltTopic } from '../fixture-seed'

afterEach(() => {
  closeSeeds()
})

async function seeded(): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string }> {
  const seededProject = await seed({
    progress: [],
    http: () => ({ status: 500, body: '{}' })
  })
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(seededProject.projectDb, project)
  return { ...seededProject, topicId }
}

describe('topic folders over IPC', () => {
  test('new topics start in No folder; create, move, rename and delete keep the list in step', async () => {
    const { handlers, topicId } = await seeded()
    const empty = await handlers['topics:createEmpty']({ projectId: 'proj-1', name: 'Pricing' })
    expect(await handlers['topics:folders']({ projectId: 'proj-1' })).toEqual({
      projectId: 'proj-1',
      folders: []
    })

    const made = await handlers['topics:createFolder']({
      projectId: 'proj-1',
      name: 'Carrier shutdowns',
      topicIds: [topicId]
    })
    expect(made.folders).toHaveLength(1)
    const folder = made.folders[0]
    if (!folder) throw new Error('no folder')
    expect(folder).toMatchObject({ name: 'Carrier shutdowns', topicIds: [topicId] })

    const moved = await handlers['topics:moveToFolder']({
      projectId: 'proj-1',
      topicIds: [empty.topicId],
      folderId: folder.id
    })
    expect(moved.folders[0]?.topicIds).toEqual([empty.topicId, topicId].sort())

    const renamed = await handlers['topics:renameFolder']({
      projectId: 'proj-1',
      folderId: folder.id,
      name: 'Carriers'
    })
    expect(renamed.folders[0]?.name).toBe('Carriers')

    const back = await handlers['topics:moveToFolder']({
      projectId: 'proj-1',
      topicIds: [topicId],
      folderId: null
    })
    expect(back.folders[0]?.topicIds).toEqual([empty.topicId])

    const gone = await handlers['topics:deleteFolder']({ projectId: 'proj-1', folderId: folder.id })
    expect(gone.folders).toEqual([])
    // The topics themselves stay, now in No folder.
    const listed = (await handlers['topics:list']({ projectId: 'proj-1' })).topics.map(
      (topic) => topic.id
    )
    expect(listed).toEqual(expect.arrayContaining([topicId, empty.topicId]))
  })

  test('refuses a taken name, an unknown folder and a bad request in plain words', async () => {
    const { handlers, topicId } = await seeded()
    await handlers['topics:createFolder']({ projectId: 'proj-1', name: 'Compliance' })
    await expect(
      handlers['topics:createFolder']({ projectId: 'proj-1', name: 'compliance' })
    ).rejects.toThrow('A folder called "compliance" already exists.')
    await expect(
      handlers['topics:moveToFolder']({
        projectId: 'proj-1',
        topicIds: [topicId],
        folderId: 'nope'
      })
    ).rejects.toThrow('That folder was not found.')
    await expect(
      handlers['topics:moveToFolder']({ projectId: 'proj-1', topicIds: [], folderId: null })
    ).rejects.toThrow()
    await expect(
      handlers['topics:createFolder']({ projectId: 'proj-1', name: '   ' })
    ).rejects.toThrow()
  })
})
