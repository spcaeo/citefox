import { describe, expect, test } from 'vitest'
import {
  parseCreateOptions,
  parseDeleteProject,
  parseProjectClaude,
  parseProjectSearch,
  parseUpdateProjectSettings
} from './ipc-project-settings'

const CHANNEL = 'projectSettings:update'

const CLAUDE = {
  connection: 'app_default',
  keyId: null,
  fallback: 'wait',
  fallbackKeyId: null,
  model: null
}

describe('project settings requests', () => {
  test('refuses unknown keys and keeps omitted parts out', () => {
    expect(parseUpdateProjectSettings({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    expect(() => parseUpdateProjectSettings({ projectId: 'proj-1', paused: true })).toThrow(
      'projectSettings:update: Invalid request'
    )
    expect(() => parseUpdateProjectSettings(null)).toThrow('Invalid request')
    expect(() => parseUpdateProjectSettings({ projectId: 'proj-1', defaultSamples: 6 })).toThrow()
    expect(
      parseUpdateProjectSettings({
        projectId: 'proj-1',
        defaultSamples: 2,
        templateOverrides: [{ kind: 'buyer_prompts', templateId: 'tpl-1' }]
      })
    ).toEqual({
      projectId: 'proj-1',
      defaultSamples: 2,
      templateOverrides: [{ kind: 'buyer_prompts', templateId: 'tpl-1' }]
    })
  })

  test('a dedicated source needs a key; a shared source drops it', () => {
    expect(() =>
      parseProjectSearch(
        { source: 'dedicated', cap: null, capRule: 'pause', dedicatedKeyId: null },
        CHANNEL
      )
    ).toThrow('Choose a dedicated key')
    expect(
      parseProjectSearch(
        { source: 'shared', cap: 500, capRule: 'allow_10', dedicatedKeyId: 'key-1' },
        CHANNEL
      )
    ).toEqual({ source: 'shared', cap: 500, capRule: 'allow_10', dedicatedKeyId: null })
    expect(() =>
      parseProjectSearch(
        { source: 'shared', cap: 1.5, capRule: 'pause', dedicatedKeyId: null },
        CHANNEL
      )
    ).toThrow('The cap must be a whole number of searches')
    expect(() =>
      parseProjectSearch(
        { source: 'shared', cap: 10, capRule: 'stop', dedicatedKeyId: null },
        CHANNEL
      )
    ).toThrow('Invalid request')
  })

  test('key ids the connection and rule do not use are dropped; bad models are refused', () => {
    expect(
      parseProjectClaude({ ...CLAUDE, keyId: 'key-a', fallbackKeyId: 'key-b' }, CHANNEL)
    ).toEqual({ ...CLAUDE })
    expect(() => parseProjectClaude({ ...CLAUDE, connection: 'api_key' }, CHANNEL)).toThrow(
      'Choose an Anthropic API key'
    )
    expect(() => parseProjectClaude({ ...CLAUDE, fallback: 'switch_key' }, CHANNEL)).toThrow(
      'Choose the API key to switch to'
    )
    expect(() => parseProjectClaude({ ...CLAUDE, model: 'opus please' }, CHANNEL)).toThrow(
      'That model name is not valid'
    )
    expect(() => parseProjectClaude({ ...CLAUDE, fallback: 'rotate_logins' }, CHANNEL)).toThrow()
  })

  test('delete takes the typed name as written; create options are optional', () => {
    expect(parseDeleteProject({ projectId: 'proj-1', confirmName: ' TextBolt' })).toEqual({
      projectId: 'proj-1',
      confirmName: ' TextBolt'
    })
    expect(() => parseDeleteProject({ projectId: 'proj-1' })).toThrow()
    expect(parseCreateOptions({}, 'projects:create')).toEqual({})
    expect(parseCreateOptions({ copySettingsFrom: null }, 'projects:create')).toEqual({
      copySettingsFrom: null
    })
    expect(() => parseCreateOptions({ copySettingsFrom: '../x' }, 'projects:create')).toThrow()
  })
})
