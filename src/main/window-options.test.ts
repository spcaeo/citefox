import { describe, expect, test } from 'vitest'
import { mainWindowWebPreferences } from './window-options'

describe('window webPreferences', () => {
  test('isolates and sandboxes the renderer', () => {
    expect(mainWindowWebPreferences('/app/preload.js', { devTools: false })).toEqual({
      preload: '/app/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      devTools: false
    })
  })

  test('DevTools follow the build: off when packaged, on for dev and e2e', () => {
    expect(mainWindowWebPreferences('/p.js', { devTools: true }).devTools).toBe(true)
    expect(mainWindowWebPreferences('/p.js', { devTools: false }).devTools).toBe(false)
  })
})
