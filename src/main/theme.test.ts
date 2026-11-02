import type { ThemePreference } from '@shared/domain'
import { THEME_GROUND } from '@shared/theme'
import { describe, expect, it } from 'vitest'
import { appearanceMenu, appMenuTemplate } from './app-menu'
import {
  createThemeController,
  windowBackground,
  type NativeThemeLike,
  type ThemeWindow
} from './theme'

/** Electron's nativeTheme, with the computer in light or dark mode. */
function fakeNative(systemDark: boolean): NativeThemeLike & {
  listeners: (() => void)[]
  setSystemDark(dark: boolean): void
} {
  let osDark = systemDark
  const listeners: (() => void)[] = []
  return {
    themeSource: 'system',
    get shouldUseDarkColors() {
      return this.themeSource === 'system' ? osDark : this.themeSource === 'dark'
    },
    on(_event, listener) {
      listeners.push(listener)
    },
    listeners,
    setSystemDark(dark) {
      osDark = dark
      for (const listener of listeners) listener()
    }
  }
}

function fakeWindow(): ThemeWindow & { colors: string[] } {
  const colors: string[] = []
  return {
    colors,
    isDestroyed: () => false,
    setBackgroundColor: (color) => {
      colors.push(color)
    }
  }
}

describe('windowBackground', () => {
  it('is the ground colour of the theme on screen', () => {
    expect(windowBackground({ shouldUseDarkColors: false })).toBe(THEME_GROUND.light)
    expect(windowBackground({ shouldUseDarkColors: true })).toBe(THEME_GROUND.dark)
    expect(THEME_GROUND.light).not.toBe('#fbfbfa')
  })
})

interface Setup {
  native: ReturnType<typeof fakeNative>
  win: ReturnType<typeof fakeWindow>
  state: { saved: ThemePreference; emitted: ThemePreference[]; applied: ThemePreference[] }
  controller: ReturnType<typeof createThemeController>
}

describe('createThemeController', () => {
  function setup(saved: ThemePreference, systemDark = false): Setup {
    const native = fakeNative(systemDark)
    const win = fakeWindow()
    const state: Setup['state'] = { saved, emitted: [], applied: [] }
    const controller = createThemeController({
      native,
      windows: () => [win],
      read: () => state.saved,
      write: (theme) => {
        state.saved = theme
      },
      emit: (theme) => state.emitted.push(theme),
      onApplied: (theme) => state.applied.push(theme)
    })
    return { native, win, state, controller }
  }

  it('applies the saved choice at start without telling the windows', () => {
    const { native, win, state, controller } = setup('dark')
    controller.start()
    expect(native.themeSource).toBe('dark')
    expect(win.colors).toEqual([THEME_GROUND.dark])
    expect(state.applied).toEqual(['dark'])
    expect(state.emitted).toEqual([])
  })

  it('follows the computer in system mode, repainting the window', () => {
    const { native, win, controller } = setup('system', false)
    controller.start()
    expect(win.colors).toEqual([THEME_GROUND.light])
    native.setSystemDark(true)
    expect(win.colors.at(-1)).toBe(THEME_GROUND.dark)
  })

  it('applies a choice Settings saved and tells the windows', () => {
    const { native, win, state, controller } = setup('system')
    controller.start()
    controller.changed('light')
    expect(native.themeSource).toBe('light')
    expect(win.colors.at(-1)).toBe(THEME_GROUND.light)
    expect(state.emitted).toEqual(['light'])
  })

  it('tells the computer light for sepia and paints the sepia page, even in dark mode', () => {
    const { native, win, state, controller } = setup('system', true)
    controller.start()
    controller.changed('sepia')
    expect(native.themeSource).toBe('light')
    expect(win.colors.at(-1)).toBe(THEME_GROUND.sepia)
    expect(windowBackground(native)).toBe(THEME_GROUND.sepia)
    expect(state.emitted).toEqual(['sepia'])
    controller.changed('dark')
    expect(windowBackground(native)).toBe(THEME_GROUND.dark)
  })

  it('saves a choice from the View menu, applies it and tells the windows', () => {
    const { native, state, controller } = setup('light')
    controller.start()
    controller.choose('dark')
    expect(state.saved).toBe('dark')
    expect(native.themeSource).toBe('dark')
    expect(state.emitted).toEqual(['dark'])
    expect(state.applied).toEqual(['light', 'dark'])
    expect(controller.current()).toBe('dark')
  })

  it('skips a closed window', () => {
    const native = fakeNative(false)
    const closed = {
      isDestroyed: () => true,
      setBackgroundColor: () => {
        throw new Error('closed')
      }
    }
    const controller = createThemeController({
      native,
      windows: () => [closed],
      read: () => 'dark',
      write: () => undefined,
      emit: () => undefined
    })
    expect(() => {
      controller.start()
    }).not.toThrow()
  })
})

describe('View › Appearance menu', () => {
  it('lists System, Light, Dark and Sepia as radio items with the saved one ticked', () => {
    const picked: ThemePreference[] = []
    const menu = appearanceMenu('dark', (theme) => picked.push(theme))
    const items = Array.isArray(menu.submenu) ? menu.submenu : []
    expect(items.map((item) => [item.label, item.type, item.checked])).toEqual([
      ['System', 'radio', false],
      ['Light', 'radio', false],
      ['Dark', 'radio', true],
      ['Sepia', 'radio', false]
    ])
    items[1]?.click?.(undefined as never, undefined, undefined as never)
    expect(picked).toEqual(['light'])
  })

  it('keeps the standard menus and puts Appearance first under View', () => {
    const template = appMenuTemplate({
      appName: 'CiteFox',
      platform: 'darwin',
      dev: false,
      theme: 'system',
      onTheme: () => undefined
    })
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'appMenu',
      'File',
      'editMenu',
      'View',
      'windowMenu'
    ])
    const view = template.find((item) => item.label === 'View')
    const viewItems = Array.isArray(view?.submenu) ? view.submenu : []
    expect(viewItems[0]?.label).toBe('Appearance')
    expect(viewItems.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })

  it('keeps Reload and the developer tools in unpackaged builds, and a File › Quit off the Mac', () => {
    const template = appMenuTemplate({
      appName: 'CiteFox',
      platform: 'win32',
      dev: true,
      theme: 'light',
      onTheme: () => undefined
    })
    expect(template[0]?.label).toBe('File')
    const fileItems = Array.isArray(template[0]?.submenu) ? template[0].submenu : []
    expect(fileItems.map((item) => item.role)).toEqual(['quit'])
    const view = template.find((item) => item.label === 'View')
    const viewItems = Array.isArray(view?.submenu) ? view.submenu : []
    expect(viewItems.some((item) => item.role === 'toggleDevTools')).toBe(true)
  })

  it('File has export and import for moving to a new Mac, then Close Window', () => {
    const commands: string[] = []
    const template = appMenuTemplate({
      appName: 'CiteFox',
      platform: 'darwin',
      dev: false,
      theme: 'system',
      onTheme: () => undefined,
      onFileCommand: (command) => commands.push(command)
    })
    const file = template.find((item) => item.label === 'File')
    const items = Array.isArray(file?.submenu) ? file.submenu : []
    expect(items.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'Export Project…',
      'Import Project…',
      'separator',
      'Export App Settings…',
      'Import App Settings…',
      'separator',
      'close'
    ])
    for (const item of items) item.click?.(undefined as never, undefined, undefined as never)
    expect(commands).toEqual([
      'export-project',
      'import-project',
      'export-settings',
      'import-settings'
    ])
  })
})
