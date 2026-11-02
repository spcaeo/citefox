import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  AUTOSTART_FILE,
  LAUNCHED_AT_LOGIN_FLAG,
  autostartDesktopEntry,
  autostartDirectory,
  autostartProgram,
  desktopExecQuote,
  launchedByAutostart,
  linuxAutostart
} from './linux-autostart'

const homes: string[] = []
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'citefox-autostart-'))
  homes.push(home)
  return home
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('Linux start at login (XDG autostart)', () => {
  test('uses XDG_CONFIG_HOME when it is absolute, else ~/.config', () => {
    expect(autostartDirectory('/home/me', {})).toBe('/home/me/.config/autostart')
    expect(autostartDirectory('/home/me', { XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/autostart')
    expect(autostartDirectory('/home/me', { XDG_CONFIG_HOME: 'rel' })).toBe(
      '/home/me/.config/autostart'
    )
  })

  test('an AppImage starts the .AppImage file, not its temporary mount', () => {
    const execPath = '/tmp/.mount_CiteFoAb12/citefox'
    expect(autostartProgram(execPath, { APPIMAGE: '/home/me/CiteFox.AppImage' })).toBe(
      '/home/me/CiteFox.AppImage'
    )
    expect(autostartProgram('/opt/CiteFox/citefox', {})).toBe('/opt/CiteFox/citefox')
    expect(autostartProgram(execPath, { APPIMAGE: 'CiteFox.AppImage' })).toBe(execPath)
  })

  test('quotes Exec per the Desktop Entry spec', () => {
    expect(desktopExecQuote('/opt/CiteFox/citefox')).toBe('"/opt/CiteFox/citefox"')
    expect(desktopExecQuote('/home/me/My Apps/CiteFox 100%.AppImage')).toBe(
      '"/home/me/My Apps/CiteFox 100%%.AppImage"'
    )
    expect(desktopExecQuote('/a"b$c`d\\e')).toBe('"/a\\\\"b\\\\$c\\\\`d\\\\\\\\e"')
    const entry = autostartDesktopEntry('/opt/CiteFox/citefox')
    expect(entry).toContain(`Exec="/opt/CiteFox/citefox" ${LAUNCHED_AT_LOGIN_FLAG}\n`)
    expect(entry.startsWith('[Desktop Entry]\nType=Application\n')).toBe(true)
    expect(() => autostartDesktopEntry('/opt/a\nb')).toThrow()
  })

  test('writes, reads and removes the entry', () => {
    const home = tempHome()
    const file = join(home, '.config', 'autostart', AUTOSTART_FILE)
    const autostart = linuxAutostart({ home, env: {}, execPath: '/opt/CiteFox/citefox' })
    expect(autostart.isEnabled()).toBe(false)
    autostart.set(true)
    expect(readFileSync(file, 'utf8')).toBe(autostartDesktopEntry('/opt/CiteFox/citefox'))
    expect(autostart.isEnabled()).toBe(true)
    autostart.set(false)
    expect(autostart.isEnabled()).toBe(false)
    autostart.set(false)
  })

  test('an entry the user disabled in their desktop settings counts as off', () => {
    const home = tempHome()
    const dir = join(home, '.config', 'autostart')
    mkdirSync(dir, { recursive: true })
    const autostart = linuxAutostart({ home, env: {}, execPath: '/opt/CiteFox/citefox' })
    writeFileSync(join(dir, AUTOSTART_FILE), '[Desktop Entry]\nX-GNOME-Autostart-enabled=false\n')
    expect(autostart.isEnabled()).toBe(false)
    writeFileSync(join(dir, AUTOSTART_FILE), '[Desktop Entry]\nHidden=true\n')
    expect(autostart.isEnabled()).toBe(false)
  })

  test('the login launch is recognised by its flag', () => {
    expect(launchedByAutostart(['/opt/CiteFox/citefox', LAUNCHED_AT_LOGIN_FLAG])).toBe(true)
    expect(launchedByAutostart(['/opt/CiteFox/citefox'])).toBe(false)
  })
})
