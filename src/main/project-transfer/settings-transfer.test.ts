import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { setEmailMode } from '../storage/email-mode'
import { configureTransferDialogs } from './dialogs'

const API_KEY = 'sk-ant-transfer-settings-secret-123456'
const WEBHOOK = 'https://hooks.slack.com/services/T111/B111/settingssecret'

let folder = ''
let filePath = ''

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'citefox-settings-transfer-'))
  filePath = join(folder, 'citefox-settings.citefox-settings.json')
  configureTransferDialogs({
    save: async () => ({ canceled: false, filePath }),
    open: async () => ({ canceled: false, filePaths: [filePath] })
  })
})

afterEach(() => {
  configureTransferDialogs(null)
  cleanupHarness()
  rmSync(folder, { recursive: true, force: true })
})

function setup(): ReturnType<typeof harness> {
  const h = harness()
  h.secrets.set('citefox.anthropic.key-1', API_KEY)
  h.secrets.set('citefox.slack.proj-1', WEBHOOK)
  h.storage.writeSettings({
    ...h.storage.readSettings(),
    userName: 'Ada',
    defaultCountry: 'GB',
    defaultLanguage: 'en',
    defaultSamples: 3,
    theme: 'dark'
  })
  setEmailMode(h.storage.db, 'mail_app')
  return h
}

describe('app settings transfer', () => {
  test('exports the preferences and never a key, token or webhook', async () => {
    const { handlers } = setup()
    const result = await handlers['transfer:exportSettings']()
    expect(result).toMatchObject({ ok: true })
    const text = readFileSync(filePath, 'utf8')
    expect(text).not.toContain(API_KEY)
    expect(text).not.toContain(WEBHOOK)
    expect(text).not.toContain('hooks.slack.com')
    const file = JSON.parse(text) as {
      format: string
      formatVersion: number
      note: string
      values: Record<string, unknown>
    }
    expect(file).toMatchObject({ format: 'citefox-settings', formatVersion: 1 })
    expect(file.note).toMatch(/API keys stay in this Mac's keychain/)
    expect(file.values).toMatchObject({
      userName: 'Ada',
      defaultCountry: 'GB',
      defaultSamples: 3,
      theme: 'dark',
      emailMode: 'mail_app'
    })
    expect(file.values).not.toHaveProperty('claudeBinaryPath')
  })

  test('import previews each field, applies the changed ones and reports per field', async () => {
    const { handlers, storage } = setup()
    await handlers['transfer:exportSettings']()
    const file = JSON.parse(readFileSync(filePath, 'utf8')) as { values: Record<string, unknown> }
    file.values.userName = 'Lin'
    file.values.theme = 'light'
    file.values.defaultSamples = 99
    file.values.emailMode = 'smtp'
    writeFileSync(filePath, JSON.stringify(file))
    const picked = await handlers['transfer:pickSettings']()
    if (!picked.ok) throw new Error(picked.reason)
    const preview = await handlers['transfer:settingsPreview']({ token: picked.token })
    const byKey = new Map(preview.fields.map((field) => [field.key, field]))
    expect(byKey.get('userName')).toMatchObject({ current: 'Ada', incoming: 'Lin', changed: true })
    expect(byKey.get('defaultCountry')).toMatchObject({ changed: false })
    expect(preview.result).toBeNull()

    const result = await handlers['transfer:applySettings']({ token: picked.token })
    const outcome = new Map(result.map((field) => [field.key, field]))
    expect(outcome.get('userName')).toMatchObject({ outcome: 'applied' })
    expect(outcome.get('theme')).toMatchObject({ outcome: 'applied' })
    expect(outcome.get('emailMode')).toMatchObject({ outcome: 'applied' })
    expect(outcome.get('defaultCountry')).toMatchObject({ outcome: 'unchanged' })
    expect(outcome.get('defaultSamples')?.outcome).toBe('failed')
    expect(outcome.get('defaultSamples')?.reason).toBeTruthy()
    expect(storage.readSettings()).toMatchObject({
      userName: 'Lin',
      theme: 'light',
      defaultSamples: 3
    })
    expect((await handlers['transfer:settingsPreview']({ token: picked.token })).result).toEqual(
      result
    )
  })

  test('refuses a file that is not a settings file, or that holds a secret', async () => {
    const { handlers } = setup()
    for (const [text, reason] of [
      ['{', /not valid JSON/],
      [
        JSON.stringify({ format: 'citefox-project', formatVersion: 1 }),
        /not a CiteFox settings file/
      ],
      [
        JSON.stringify({
          format: 'citefox-settings',
          formatVersion: 1,
          values: { userName: API_KEY }
        }),
        /key or a password/
      ],
      [
        JSON.stringify({
          format: 'citefox-settings',
          formatVersion: 1,
          values: { slackWebhook: 'x' }
        }),
        /does not know/
      ]
    ] as const) {
      writeFileSync(filePath, text)
      const picked = await handlers['transfer:pickSettings']()
      expect(picked.ok).toBe(false)
      if (!picked.ok) expect(picked.reason).toMatch(reason)
    }
  })
})
