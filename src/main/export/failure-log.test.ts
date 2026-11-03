import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { configureTransferDialogs, openText, saveText } from '../project-transfer/dialogs'
import { nodeExportIo } from './atomic'
import { fixtureExportSource, sampleExportDataset, sampleExportRequest } from './fixture'
import { startExport } from './service'

const directories: string[] = []

afterEach(() => {
  configureTransferDialogs(null)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function folder(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-export-log-'))
  directories.push(directory)
  return directory
}

function capture(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = []
  return { lines, logger: createLogger({ write: (_level, line) => lines.push(line) }) }
}

function denied(): NodeJS.ErrnoException {
  return Object.assign(new Error('EACCES: permission denied, open /Users/secret-person/x'), {
    code: 'EACCES'
  })
}

describe('a file that cannot be written or read leaves one line with a short code', () => {
  test('an export that cannot be written', async () => {
    const { logger, lines } = capture()
    const io = nodeExportIo()
    const result = await startExport({
      request: sampleExportRequest({ sections: ['prompts'], checks: 'latest' }),
      source: fixtureExportSource(sampleExportDataset()),
      directory: folder(),
      logger,
      io: {
        writeFile: () => Promise.reject(denied()),
        rename: io.rename.bind(io),
        unlink: io.unlink.bind(io)
      }
    })
    expect(result.ok).toBe(false)
    expect(lines[0]).toContain('export file could not be written')
    expect(lines[0]).toContain('"code":"EACCES"')
    expect(lines[0]).toContain('"format":"csv"')
    expect(lines.join('\n')).not.toContain('secret-person')
  })

  test('a project file that cannot be saved', async () => {
    const { logger, lines } = capture()
    configureTransferDialogs(
      {
        save: () => Promise.resolve({ canceled: false, filePath: join(folder(), 'project.json') }),
        open: () => Promise.resolve({ canceled: true, filePaths: [] })
      },
      logger
    )
    const io = nodeExportIo()
    const result = await saveText(
      {
        title: 'Save',
        defaultName: 'project.json',
        filter: { name: 'JSON', extensions: ['json'] }
      },
      '{"private":"text"}',
      {
        writeFile: () => Promise.reject(denied()),
        rename: io.rename.bind(io),
        unlink: io.unlink.bind(io)
      }
    )
    expect(result.ok).toBe(false)
    expect(lines[0]).toContain('project file could not be written')
    expect(lines[0]).toContain('"code":"EACCES"')
    expect(lines.join('\n')).not.toContain('secret-person')
    expect(lines.join('\n')).not.toContain('private')
  })

  test('a project file that cannot be read', async () => {
    const { logger, lines } = capture()
    configureTransferDialogs(
      {
        save: () => Promise.resolve({ canceled: true }),
        open: () =>
          Promise.resolve({
            canceled: false,
            filePaths: [join(folder(), 'secret-person-missing.json')]
          })
      },
      logger
    )
    const result = await openText({
      title: 'Open',
      filter: { name: 'JSON', extensions: ['json'] }
    })
    expect(result.ok).toBe(false)
    expect(lines[0]).toContain('project file could not be read')
    expect(lines[0]).toContain('"code":"ENOENT"')
    expect(lines.join('\n')).not.toContain('secret-person')
  })
})

describe('without a logger', () => {
  test('a failed export still answers and nothing throws', async () => {
    const io = nodeExportIo()
    const result = await startExport({
      request: sampleExportRequest({ sections: ['prompts'], checks: 'latest' }),
      source: fixtureExportSource(sampleExportDataset()),
      directory: folder(),
      io: {
        writeFile: () => Promise.reject(denied()),
        rename: io.rename.bind(io),
        unlink: io.unlink.bind(io)
      }
    })
    expect(result.ok).toBe(false)
  })
})
