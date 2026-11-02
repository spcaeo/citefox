import { redactString } from './logging/redact'

export interface StartupErrorContext {
  /** `<userData>/logs/citefox.log`. */
  logFile: string
  /** The CiteFox data folder. */
  userDataDir: string
  /** Keychain secrets to mask in the error text. */
  secrets?: readonly string[]
}

export interface StartupErrorBox {
  title: string
  content: string
}

const NEWER_DATA = /newer than this app/i

/** True when storage refused a database or settings.json written by a newer CiteFox. */
export function isNewerDataError(error: unknown): boolean {
  return error instanceof Error && NEWER_DATA.test(error.message)
}

/**
 * Text for `dialog.showErrorBox` when the GUI cannot start. The error text is
 * redacted, and the log file path is included so a user can attach it to a
 * bug report. Headless `--check-due` never shows this.
 */
export function startupErrorBox(error: unknown, context: StartupErrorContext): StartupErrorBox {
  if (isNewerDataError(error)) {
    return {
      title: 'CiteFox needs to be updated',
      content: [
        'Your CiteFox data was saved by a newer version of CiteFox, so this version cannot open it.',
        'Install the latest CiteFox and open it again. Your data has not been changed.',
        '',
        `Data folder: ${context.userDataDir}`,
        `Log file: ${context.logFile}`
      ].join('\n')
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return {
    title: 'CiteFox could not start',
    content: [
      'CiteFox hit a problem while starting and will close.',
      '',
      redactString(detail, { secrets: context.secrets }),
      '',
      `Details are in the log file: ${context.logFile}`
    ].join('\n')
  }
}
