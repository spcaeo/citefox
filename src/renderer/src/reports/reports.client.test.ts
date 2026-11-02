import { afterEach, describe, expect, it } from 'vitest'
import type { ExportStartResult } from '@shared/domain'
import type { CiteFoxApi, SetAutoExportRequest } from '@shared/ipc'
import { createLiveReportsClient } from './client'
import {
  buildExportRequest,
  defaultExportForm,
  specOf,
  type ExportBuildSource
} from './export/model'

const EXPORT_SOURCE: ExportBuildSource = {
  projectId: 'textbolt',
  pageId: 'alerts',
  marketIds: ['us', 'austin']
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('exports IPC', () => {
  it('does not fall back to the mock in a production build', async () => {
    install(failingApi())
    const client = createLiveReportsClient()
    const request = buildExportRequest(defaultExportForm(), EXPORT_SOURCE)
    const preview = await client.previewExport(request)
    expect(preview).toEqual({
      blocked: true,
      reason: 'The engine is busy.',
      nextStep: null,
      pageCount: 0,
      marketCount: 0,
      checkCount: 0,
      sections: [],
      estimatedBytes: 0,
      preview: ''
    })
    const started = await client.startExport({ ...request, format: 'csv', csv: request.csv })
    expect(started).toEqual({
      ok: false,
      reason: 'The engine is busy.',
      nextStep: null
    })
    await expect(
      client.getAutoExport({ projectId: request.projectId, pageId: 'alerts' })
    ).rejects.toMatchObject({
      message: 'The engine is busy.',
      nextStep: null
    })
    await expect(client.setAutoExport(autoRequest(request))).rejects.toMatchObject({
      message: 'The engine is busy.',
      nextStep: null
    })
    await expect(
      client.chooseAutoExportFolder({ projectId: request.projectId, pageId: 'alerts' })
    ).rejects.toMatchObject({ message: 'The engine is busy.', nextStep: null })
    const ipc = createLiveReportsClient()
    expect((await ipc.previewExport(request)).estimatedBytes).toBe(0)
    expect((await ipc.startExport(request)).ok).toBe(false)
  })

  it('returns the bridge result when the handler is implemented', async () => {
    const ready: ExportStartResult = {
      ok: true,
      exportId: 'from-main',
      filePath: '/tmp/report.pdf',
      filename: 'report.pdf',
      bytes: 10,
      format: 'pdf'
    }
    const blocked = {
      ok: false as const,
      reason: 'Pick at least one market.',
      nextStep: null
    }
    install({
      ...failingApi(),
      'exports:start': () => Promise.resolve(ready)
    })
    const client = createLiveReportsClient()
    expect(
      await client.startExport(buildExportRequest(defaultExportForm(), EXPORT_SOURCE))
    ).toEqual(ready)
    install({
      ...failingApi(),
      'exports:start': () => Promise.resolve(blocked)
    })
    expect(
      await client.startExport(buildExportRequest(defaultExportForm(), EXPORT_SOURCE))
    ).toEqual(blocked)
  })

  it('strips the Electron invoke wrapper', async () => {
    install({
      ...failingApi(),
      'exports:preview': () =>
        Promise.reject(
          new Error("Error invoking remote method 'exports:preview': Error: The engine is busy.")
        ),
      'exports:start': () =>
        Promise.reject(
          new Error(
            "Error invoking remote method 'exports:start': Error: Pick at least one market."
          )
        )
    })
    const client = createLiveReportsClient()
    const request = buildExportRequest(defaultExportForm(), EXPORT_SOURCE)
    const preview = await client.previewExport(request)
    expect(preview.reason).toBe('The engine is busy.')
    expect(JSON.stringify(preview)).not.toContain('Error invoking remote method')
    expect(JSON.stringify(preview)).not.toContain('Error invoking remote method')
    expect(await client.startExport(request)).toEqual({
      ok: false,
      reason: 'Pick at least one market.',
      nextStep: null
    })
  })
})

function failingApi(): Partial<CiteFoxApi> {
  return {
    'exports:preview': () => Promise.reject(new Error('The engine is busy.')),
    'exports:start': () => Promise.reject(new Error('The engine is busy.')),
    'exports:getAuto': () => Promise.reject(new Error('The engine is busy.')),
    'exports:setAuto': () => Promise.reject(new Error('The engine is busy.')),
    'exports:chooseAutoFolder': () => Promise.reject(new Error('The engine is busy.')),
    'exports:progress': () => () => undefined
  }
}

function autoRequest(request: ReturnType<typeof buildExportRequest>): SetAutoExportRequest {
  return {
    projectId: request.projectId,
    pageId: 'alerts',
    enabled: true,
    destination: 'folder',
    folder: null,
    emailTo: null,
    spec: specOf(request)
  }
}

function install(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { citefox: api }
  })
}
