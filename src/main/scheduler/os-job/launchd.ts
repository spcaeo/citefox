import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  NEXT_STEP,
  ensureDirectory,
  failureDetail,
  logPaths,
  removeFile,
  removeFileQuietly,
  succeeded,
  validateSpec,
  writeFileAtomic
} from './shared'
import { OsJobError } from './types'
import type { CommandRunner, OsJobInstaller, OsJobSpec } from './types'

export const LAUNCHD_LABEL = 'app.citefox.checkdue'

export function launchAgentPlistPath(home: string): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The LaunchAgent plist. StartCalendarInterval with only Minute fires every hour; launchd
 * coalesces fires missed during sleep into one on wake.
 */
export function launchAgentPlist(spec: OsJobSpec): string {
  const logs = logPaths(spec)
  const string = (value: string): string => `<string>${xmlEscape(value)}</string>`
  const programArguments = [spec.program, ...spec.args]
    .map((value) => `\t\t${string(value)}`)
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>Label</key>',
    `\t${string(LAUNCHD_LABEL)}`,
    '\t<key>ProgramArguments</key>',
    '\t<array>',
    programArguments,
    '\t</array>',
    '\t<key>StartCalendarInterval</key>',
    '\t<dict>',
    '\t\t<key>Minute</key>',
    `\t\t<integer>${spec.minute}</integer>`,
    '\t</dict>',
    '\t<key>RunAtLoad</key>',
    '\t<false/>',
    '\t<key>ProcessType</key>',
    '\t<string>Background</string>',
    '\t<key>StandardOutPath</key>',
    `\t${string(logs.stdout)}`,
    '\t<key>StandardErrorPath</key>',
    `\t${string(logs.stderr)}`,
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

/** macOS: a per-user LaunchAgent in ~/Library/LaunchAgents, loaded into the gui/<uid> domain. */
export function launchdInstaller(input: {
  home: string
  uid: number | null
  runner: CommandRunner
}): OsJobInstaller {
  const { runner } = input
  const plistPath = launchAgentPlistPath(input.home)
  const uid = input.uid !== null && Number.isInteger(input.uid) && input.uid >= 0 ? input.uid : null

  function domain(): string {
    if (uid === null) {
      throw new OsJobError(
        `CiteFox could not find your macOS user ID, so it cannot manage the background check. Restart CiteFox and try again. ${NEXT_STEP}`
      )
    }
    return `gui/${uid}`
  }

  function isLoaded(): boolean {
    if (uid === null) return false
    return succeeded(runner.run('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`]))
  }

  return {
    kind: 'launchd',

    install(spec: OsJobSpec): void {
      validateSpec(spec, 'posix')
      const target = domain()
      const plist = launchAgentPlist(spec)
      ensureDirectory(dirname(plistPath), 'the LaunchAgents folder')
      ensureDirectory(spec.logDirectory, 'the background check log folder')
      if (isLoaded()) runner.run('launchctl', ['bootout', `${target}/${LAUNCHD_LABEL}`])
      writeFileAtomic(plistPath, plist, 0o644, 'the background check file')

      const bootstrap = runner.run('launchctl', ['bootstrap', target, plistPath])
      if (succeeded(bootstrap)) return
      // Older macOS, or a domain that refuses bootstrap: the legacy subcommand. `load` can exit 0
      // without loading anything, so confirm it really registered.
      const load = runner.run('launchctl', ['load', '-w', plistPath])
      if (succeeded(load) && isLoaded()) return

      removeFileQuietly(plistPath)
      throw new OsJobError(
        `macOS did not accept CiteFox's background check (launchctl: ${failureDetail(bootstrap)}). Nothing was installed. ${NEXT_STEP}`
      )
    },

    remove(): void {
      // Without a user ID nothing can have been bootstrapped by us; only a stray file can remain.
      if (uid === null && !existsSync(plistPath)) return
      const target = domain()
      const bootout = runner.run('launchctl', ['bootout', `${target}/${LAUNCHD_LABEL}`])
      if (!succeeded(bootout) && existsSync(plistPath)) {
        runner.run('launchctl', ['unload', '-w', plistPath])
      }
      removeFile(plistPath, 'the background check file')
      if (existsSync(plistPath) || isLoaded()) {
        throw new OsJobError(
          `CiteFox could not stop its background check in macOS (launchctl: ${failureDetail(bootout)}). Log out and back in, then turn the setting off again.`
        )
      }
    },

    isInstalled(): boolean {
      return existsSync(plistPath) && isLoaded()
    }
  }
}
