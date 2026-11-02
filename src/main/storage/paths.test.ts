import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { appDataPaths, appDataPathsFrom } from './paths'

describe('app data paths', () => {
  test('lays out app.sqlite, settings.json, and projects/ under userData', () => {
    const root = resolve('/tmp/citefox-user')
    expect(appDataPaths('/tmp/citefox-user')).toEqual({
      root,
      appDatabase: join(root, 'app.sqlite'),
      settingsFile: join(root, 'settings.json'),
      projectsDirectory: join(root, 'projects'),
      windowStateFile: join(root, 'window-state.json'),
      onboardingDraftFile: join(root, 'onboarding-draft.json')
    })
  })

  test('reads userData from an injected path source', () => {
    const paths = appDataPathsFrom({
      getPath: (name) => {
        expect(name).toBe('userData')
        return '/var/citefox'
      }
    })
    expect(paths.settingsFile).toBe(resolve('/var/citefox/settings.json'))
    expect(paths.appDatabase).toBe(resolve('/var/citefox/app.sqlite'))
    expect(paths.projectsDirectory).toBe(resolve('/var/citefox/projects'))
  })
})
