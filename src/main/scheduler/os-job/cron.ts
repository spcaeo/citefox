import {
  NEXT_STEP,
  ensureDirectory,
  failureDetail,
  logPaths,
  succeeded,
  validateSpec
} from './shared'
import { OsJobError } from './types'
import type { CommandRunner, OsJobInstaller, OsJobSpec } from './types'

/** Trailing comment that marks CiteFox's line in the user's crontab. */
export const CRON_MARKER = '# citefox-checkdue'

/** POSIX sh single-quoting; plain words stay bare. */
export function shQuote(value: string): string {
  if (/^[A-Za-z0-9_/.,:=+@-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** cron turns an unescaped % into a newline, so every % in the command is escaped. */
function escapeCronPercent(value: string): string {
  return value.replace(/%/g, '\\%')
}

/** `MM * * * * <command> >>log 2>>errlog # citefox-checkdue` */
export function cronLine(spec: OsJobSpec): string {
  const logs = logPaths(spec)
  const command = [spec.program, ...spec.args].map(shQuote).join(' ')
  const redirect = `>>${shQuote(logs.stdout)} 2>>${shQuote(logs.stderr)}`
  return `${spec.minute} * * * * ${escapeCronPercent(`${command} ${redirect}`)} ${CRON_MARKER}`
}

function hasMarker(line: string): boolean {
  return line.includes(CRON_MARKER)
}

/** Drops CiteFox's marker lines and optionally appends a new one; keeps every other line. */
export function rewriteCrontab(current: string, line: string | null): string {
  const lines = current === '' ? [] : current.replace(/\r?\n$/, '').split(/\r?\n/)
  const kept = lines.filter((existing) => !hasMarker(existing))
  if (line !== null) kept.push(line)
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`
}

type CrontabRead = { ok: true; content: string } | { ok: false; detail: string }

/** `crontab -l`; "no crontab for <user>" means an empty crontab. */
export function readCrontab(runner: CommandRunner): CrontabRead {
  const result = runner.run('crontab', ['-l'])
  if (succeeded(result)) return { ok: true, content: result.stdout }
  if (result.error === null && /no crontab/i.test(`${result.stderr}\n${result.stdout}`)) {
    return { ok: true, content: '' }
  }
  return { ok: false, detail: failureDetail(result) }
}

function writeCrontab(runner: CommandRunner, content: string): { ok: boolean; detail: string } {
  const result = runner.run('crontab', ['-'], { input: content })
  return { ok: succeeded(result), detail: failureDetail(result) }
}

export function crontabHasMarker(runner: CommandRunner): boolean {
  const read = readCrontab(runner)
  return read.ok && read.content.split(/\r?\n/).some(hasMarker)
}

/** Removes the marker line if present. Returns a failure detail, or null when nothing is left. */
export function stripCronMarker(runner: CommandRunner): string | null {
  const read = readCrontab(runner)
  if (!read.ok) return null // No usable crontab means no CiteFox line in it.
  if (!read.content.split(/\r?\n/).some(hasMarker)) return null
  const written = writeCrontab(runner, rewriteCrontab(read.content, null))
  return written.ok ? null : written.detail
}

/** Installs the cron line. Returns a failure detail, or null on success. */
export function installCronLine(runner: CommandRunner, spec: OsJobSpec): string | null {
  const read = readCrontab(runner)
  if (!read.ok) return `crontab: ${read.detail}`
  const written = writeCrontab(runner, rewriteCrontab(read.content, cronLine(spec)))
  return written.ok ? null : `crontab: ${written.detail}`
}

/** Linux/Unix without systemd: one marked line in the user's crontab. */
export function cronInstaller(input: { runner: CommandRunner }): OsJobInstaller {
  const { runner } = input
  return {
    kind: 'cron',

    install(spec: OsJobSpec): void {
      validateSpec(spec, 'posix')
      ensureDirectory(spec.logDirectory, 'the background check log folder')
      const failure = installCronLine(runner, spec)
      if (failure !== null) {
        throw new OsJobError(
          `CiteFox could not add its background check to your crontab (${failure}). Nothing was installed. ${NEXT_STEP}`
        )
      }
    },

    remove(): void {
      const failure = stripCronMarker(runner)
      if (failure !== null || crontabHasMarker(runner)) {
        throw new OsJobError(
          `CiteFox could not remove its background check from your crontab (crontab: ${failure ?? 'the line is still there'}). Run "crontab -e" and delete the line ending in "${CRON_MARKER}".`
        )
      }
    },

    isInstalled(): boolean {
      return crontabHasMarker(runner)
    }
  }
}
