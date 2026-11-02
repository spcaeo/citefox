import { afterEach, describe, expect, test } from 'vitest'
import type { OpenTerminalResult } from '@shared/ipc'
import { DEFAULT_CLAUDE_MODEL } from '../providers/claude/model'
import { providerCommandSpawnOptions } from '../providers/command'
import {
  BINARY,
  cleanupHarness,
  harness,
  keyRequest,
  noSecret,
  profile,
  rejected,
  SECRET
} from './test-harness'

afterEach(cleanupHarness)

describe('IPC handlers: connections, settings, and status', () => {
  test('connections:getOverview is empty until keys and a checkup exist', async () => {
    const { handlers, logs } = harness()
    const overview = await handlers['connections:getOverview']()
    expect(overview).toEqual({
      serpapiRotation: 'in_order',
      keys: [],
      serpapi: 'off',
      claudeCode: 'unchecked',
      jina: 'off',
      youtube: 'off',
      claudeCheckup: null,
      searchesLeft: null,
      issueCount: 0
    })
    expect(noSecret(overview, logs, SECRET)).toBe(true)
    await expect(rejected(handlers, 'connections:getOverview', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })

  test('claudeCode checkup forwards progress, stores api_key login, and reads the latest row', async () => {
    const { handlers, progress, logs, command } = harness()
    expect(await handlers['claudeCode:getCheckup']()).toBeNull()
    const ready = await handlers['claudeCode:runCheckup']({ binaryPath: BINARY })
    expect(ready.ready).toBe(true)
    expect(ready.login).toBe('logged_in')
    expect(ready.resolvedModel).toBe(DEFAULT_CLAUDE_MODEL)
    expect(progress.map((event) => `${event.phase}:${event.state}`)).toContain('binary:running')
    expect(progress.at(-1)?.phase).toBe('roundTrip')
    const print = command.calls.find((call) => call.args.includes('-p'))
    expect(print?.stdin).toContain('Reply with JSON only')
    expect(providerCommandSpawnOptions(print ?? { stdin: null }).stdio).toEqual([
      'pipe',
      'pipe',
      'pipe'
    ])
    expect(print?.args[print.args.indexOf('--model') + 1]).toBe(DEFAULT_CLAUDE_MODEL)
    expect(await handlers['claudeCode:getCheckup']()).toEqual(ready)
    expect((await handlers['connections:getOverview']()).claudeCheckup?.resolvedModel).toBe(
      DEFAULT_CLAUDE_MODEL
    )

    progress.length = 0
    command.auth = JSON.stringify({ loggedIn: true, authMethod: 'api_key' })
    const keyed = await handlers['claudeCode:runCheckup']({ binaryPath: null })
    expect(keyed.login).toBe('api_key')
    expect(keyed.rows.login.statusLabel).toBe('API key only')
    expect(keyed.roundTrip).toBe('skipped')
    expect(keyed.resolvedModel).toBeNull()
    expect((await handlers['claudeCode:getCheckup']())?.login).toBe('api_key')
    expect((await handlers['connections:getOverview']()).claudeCheckup?.resolvedModel).toBeNull()
    expect((await handlers['connections:getOverview']()).claudeCode).toBe('warning')
    expect(noSecret({ ready, keyed, progress }, logs, SECRET)).toBe(true)
    await expect(
      handlers['claudeCode:runCheckup']({ binaryPath: null, secret: SECRET } as never)
    ).rejects.toThrow('claudeCode:runCheckup: Invalid request')
    await expect(rejected(handlers, 'claudeCode:getCheckup', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })

  test('claudeCode:openTerminal does not run claude login', async () => {
    const opened: string[] = []
    const { handlers, logs } = harness({
      openTerminal: async (): Promise<OpenTerminalResult> => {
        opened.push('terminal')
        return { opened: true, message: 'Opened a terminal. Run claude and log in there.' }
      }
    })
    await expect(handlers['claudeCode:openTerminal']()).resolves.toMatchObject({ opened: true })
    expect(opened).toEqual(['terminal'])
    const failed = harness({
      openTerminal: async () => ({
        opened: false,
        message: 'Could not open a terminal. Open one yourself and run claude to log in.'
      })
    })
    await expect(failed.handlers['claudeCode:openTerminal']()).resolves.toMatchObject({
      opened: false
    })
    expect(noSecret(opened, logs, SECRET)).toBe(true)
    await expect(rejected(handlers, 'claudeCode:openTerminal', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })

  test('settings:update saves the theme and hands only a theme change to main', async () => {
    const changes: string[] = []
    const { handlers, storage } = harness({ onThemeChanged: (theme) => changes.push(theme) })
    expect((await handlers['settings:get']()).settings.theme).toBe('sepia')
    const dark = await handlers['settings:update']({ theme: 'dark' })
    expect(dark.settings.theme).toBe('dark')
    expect(storage.readSettings().theme).toBe('dark')
    await handlers['settings:update']({ userName: 'Ada' })
    expect(storage.readSettings().theme).toBe('dark')
    expect(changes).toEqual(['dark'])
    await expect(handlers['settings:update']({ theme: 'auto' } as never)).rejects.toThrow(
      'settings:update: Invalid request'
    )
    expect(changes).toEqual(['dark'])
  })

  test('settings:get and settings:update keep secrets out and do not rewind a saved market', async () => {
    const { handlers, storage, logs } = harness()
    const initial = await handlers['settings:get']()
    expect(initial.dataDirectory).toBe(storage.paths.root)
    expect(initial.settings.defaultIntervalDays).toBe(7)
    expect(initial.settings.defaultDevice).toBe('desktop')
    expect(initial.settings.userName).toBeNull()
    expect(initial.settings.claudeModel).toBeNull()
    expect(initial.settings.serpapiRotation).toBe('in_order')
    const updated = await handlers['settings:update']({
      defaultCountry: 'GB',
      defaultLanguage: 'pt-BR',
      claudeConcurrency: 2,
      jinaMode: 'always'
    })
    expect(updated.settings.defaultCountry).toBe('GB')
    expect(updated.settings.defaultLanguage).toBe('pt-BR')
    expect(updated.settings.jinaMode).toBe('always')
    await handlers['onboarding:saveProfile'](profile())
    expect(storage.readSettings().defaultCountry).toBe('GB')
    await expect(
      handlers['settings:update']({ claudeModel: SECRET, extra: true } as never)
    ).rejects.toThrow('settings:update: Invalid request')
    expect(storage.readSettings().claudeModel).toBeNull()
    const saved = await handlers['settings:update']({ serpapiRotation: 'in_order' })
    expect(saved.settings.serpapiRotation).toBe('in_order')
    const spread = await handlers['settings:update']({ serpapiRotation: 'spread_evenly' })
    expect(spread.settings.serpapiRotation).toBe('spread_evenly')
    const projectKeys = await handlers['settings:update']({ serpapiRotation: 'project_keys' })
    expect(projectKeys.settings.serpapiRotation).toBe('project_keys')
    await handlers['settings:update']({ serpapiRotation: 'in_order' })
    await expect(
      handlers['settings:update']({ serpapiRotation: 'round_robin' as 'in_order' })
    ).rejects.toThrow('settings:update: Invalid request')
    expect(storage.readSettings().serpapiRotation).toBe('in_order')
    expect(noSecret(updated, logs, SECRET)).toBe(true)
    await expect(rejected(handlers, 'settings:get', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })

  test('status:getCapsule counts warning connections and hides nothing from the payload', async () => {
    const { handlers, storage, logs } = harness()
    const serp = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    await handlers['keys:test']({ id: serp.id })
    const jina = await handlers['keys:add'](keyRequest('jina', 'jina-secret-value-zzzz', null))
    const jinaTest = await handlers['keys:test']({ id: jina.id })
    expect(jinaTest.key.state).toBe('warning')
    const youtube = await handlers['keys:add'](
      keyRequest('youtube', 'youtube-secret-value-yyyy', null)
    )
    expect(youtube.state).toBe('unchecked')
    const { updateApiKey } = await import('../storage/records')
    updateApiKey(storage.db, { ...youtube, state: 'warning' })
    await handlers['claudeCode:runCheckup']({ binaryPath: BINARY })
    const capsule = await handlers['status:getCapsule']()
    const overview = await handlers['connections:getOverview']()
    expect(capsule).toEqual({
      searchesLeft: overview.searchesLeft,
      issueCount: overview.issueCount,
      serpapi: overview.serpapi,
      claudeCode: overview.claudeCode,
      jina: overview.jina,
      youtube: overview.youtube
    })
    expect(capsule.serpapi).toBe('ok')
    expect(capsule.jina).toBe('warning')
    expect(capsule.youtube).toBe('warning')
    expect(capsule.claudeCode).toBe('ok')
    expect(capsule.issueCount).toBe(2)
    expect(overview.searchesLeft).toBe(212)
    expect(noSecret(capsule, logs, SECRET)).toBe(true)
    expect(noSecret(overview, logs, 'jina-secret-value-zzzz')).toBe(true)
    expect(noSecret(overview, logs, 'youtube-secret-value-yyyy')).toBe(true)
    await expect(rejected(handlers, 'status:getCapsule', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })
})
