import { afterEach, expect, test, vi } from 'vitest'
import { closeSeeds, seed } from '../engine/checks/checks.test-helper'

vi.mock('../engine/prompt-add', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine/prompt-add')>()),
  appendQuestions: () => {
    throw new Error('disk failure at /Users/secret-person/project.sqlite')
  }
}))

afterEach(() => closeSeeds())

test('rows that could not be added are logged with a count and the error type only', async () => {
  const logLines: string[] = []
  const { handlers } = await seed({
    progress: [],
    logLines,
    http: () => ({ status: 500, body: '{}' })
  })
  const commit = await handlers['import:commit']({
    projectId: 'proj-1',
    entity: 'questions',
    targetId: 'page-1',
    rules: { keywords: true },
    rows: [
      {
        values: { question: 'how do I send one text alert to every driver on the night shift' },
        keep: false
      }
    ]
  })
  expect(commit.added).toBe(0)
  expect(commit.skipped).toHaveLength(1)
  const line = logLines.find((entry) => entry.includes('import rows were not added'))
  expect(line).toContain('"rows":1')
  expect(line).toContain('"threw":"Error"')
  expect(logLines.join('\n')).not.toContain('secret-person')
  expect(logLines.join('\n')).not.toContain('night shift')
})
