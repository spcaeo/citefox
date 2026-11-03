import { afterEach, describe, expect, test } from 'vitest'
import { configureDiagnosticsShell } from '../diagnostics/shell'
import { cleanupHarness, harness } from './test-harness'

afterEach(() => {
  configureDiagnosticsShell(null)
  cleanupHarness()
})

const OK = { includeQuestions: false, note: 'hi', projectId: null }

describe('IPC handlers: diagnostics', () => {
  test('diagnostics:build returns the exact report text with its size', async () => {
    const { handlers } = harness()
    const report = await handlers['diagnostics:build'](OK)
    expect(report.text).toContain('CiteFox problem report')
    expect(report.text).toContain('hi')
    expect(report.bytes).toBe(Buffer.byteLength(report.text))
    expect(report.lines).toBeGreaterThan(10)
  })

  test.each([
    ['not an object', 'text'],
    ['null', null],
    ['an array', []],
    ['no includeQuestions', { note: '', projectId: null }],
    ['includeQuestions as a string', { includeQuestions: 'yes', note: '', projectId: null }],
    ['a note that is not text', { ...OK, note: 5 }],
    ['a note over 2000 characters', { ...OK, note: 'x'.repeat(2001) }],
    ['a project id with a path in it', { ...OK, projectId: '../../etc/passwd' }],
    ['a project id that is not text', { ...OK, projectId: 7 }],
    ['an extra field', { ...OK, path: '/etc/passwd' }]
  ])('diagnostics:build refuses %s', async (_name, request) => {
    const { handlers } = harness()
    await expect(handlers['diagnostics:build'](request as never)).rejects.toThrow(
      /Request failed|diagnostics:build/
    )
  })

  test('diagnostics:build takes a note of exactly 2000 characters', async () => {
    const { handlers } = harness()
    const report = await handlers['diagnostics:build']({ ...OK, note: 'x'.repeat(2000) })
    expect(report.text).toContain('x'.repeat(2000))
  })

  test('diagnostics:send needs consent: true, and sends nothing in a test build', async () => {
    const { handlers } = harness()
    const base = { ...OK, consent: true }
    await expect(handlers['diagnostics:send']({ ...base, consent: false })).rejects.toThrow()
    await expect(handlers['diagnostics:send']({ ...OK } as never)).rejects.toThrow()
    await expect(
      handlers['diagnostics:send']({ ...base, consent: 'yes' } as never)
    ).rejects.toThrow()
    await expect(
      handlers['diagnostics:send']({ ...base, note: 'x'.repeat(2001) })
    ).rejects.toThrow()
    await expect(handlers['diagnostics:send']({ ...base, text: '' })).rejects.toThrow()
    await expect(
      handlers['diagnostics:send']({ ...base, text: 'x'.repeat(400_001) })
    ).rejects.toThrow()
    await expect(handlers['diagnostics:send']({ ...base, extra: 1 } as never)).rejects.toThrow()
    // The harness has no registration address, so the send is the dev no-op.
    expect(await handlers['diagnostics:send'](base)).toEqual({ ok: false, error: 'offline' })
    expect(await handlers['diagnostics:send']({ ...base, text: 'shown text' })).toEqual({
      ok: false,
      error: 'offline'
    })
  })

  test.each([
    ['no text', {}],
    ['empty text', { text: '' }],
    ['text over the limit', { text: 'x'.repeat(400_001) }],
    ['a path field', { text: 'x', path: '/tmp/x' }],
    ['text that is not a string', { text: 3 }]
  ])('diagnostics:save refuses %s before any dialog opens', async (_name, request) => {
    const { handlers } = harness()
    await expect(handlers['diagnostics:save'](request as never)).rejects.toThrow()
  })

  test('diagnostics:save says the dialog is not available instead of writing', async () => {
    const { handlers } = harness()
    await expect(handlers['diagnostics:save']({ text: 'x' })).rejects.toThrow()
  })

  test('diagnostics:open-mail validates the note and only opens a mailto link', async () => {
    const { handlers } = harness()
    await expect(handlers['diagnostics:open-mail']({ note: 'x'.repeat(2001) })).rejects.toThrow()
    await expect(handlers['diagnostics:open-mail']({ note: 1 } as never)).rejects.toThrow()
    await expect(
      handlers['diagnostics:open-mail']({ note: '', to: 'https://evil.test' } as never)
    ).rejects.toThrow()
    const opened: string[] = []
    configureDiagnosticsShell((url) => {
      opened.push(url)
      return Promise.resolve()
    })
    expect(await handlers['diagnostics:open-mail']({ note: 'short' })).toEqual({ ok: true })
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatch(/^mailto:/)
  })

  test('diagnostics:reveal-logs opens the logs folder, or says why it cannot', async () => {
    const { handlers, storage } = harness()
    const { configureDataFolderReveal } = await import('../export/data-folder')
    const shown: string[] = []
    configureDataFolderReveal((path) => {
      shown.push(path)
    })
    try {
      const result = await handlers['diagnostics:reveal-logs']()
      expect(result).toEqual({ ok: true })
      expect(shown[0]?.startsWith(storage.paths.root)).toBe(true)
      configureDataFolderReveal(null)
      expect(await handlers['diagnostics:reveal-logs']()).toMatchObject({ ok: false })
    } finally {
      configureDataFolderReveal(null)
    }
  })
})
