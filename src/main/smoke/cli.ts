import { redactString } from '../logging/redact'
import type { BinaryProbe } from '../providers'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import { SmokeError, runSmokeLive } from './live'
import type { SmokeIo } from './live'

export interface SmokeCliOptions {
  env?: NodeJS.ProcessEnv
  io?: SmokeIo
  cwd?: string
  dataDir?: string
  http?: HttpTransport
  command?: CommandTransport
  probe?: BinaryProbe
  home?: string
  platform?: NodeJS.Platform
  now?: () => Date
}

/** Process entry. Prints a failure once. A reported `SmokeError` is already on stderr. */
export async function runSmokeCli(
  argv: readonly string[],
  options: SmokeCliOptions = {}
): Promise<number> {
  const env = options.env ?? process.env
  const io = options.io ?? {
    stdout: (line) => {
      console.log(line)
    },
    stderr: (line) => {
      console.error(line)
    }
  }
  try {
    const report = await runSmokeLive({
      argv,
      cwd: options.cwd ?? process.cwd(),
      envFlag: env.CITEFOX_SMOKE_LIVE,
      parentEnv: env,
      io,
      dataDir: options.dataDir,
      http: options.http,
      command: options.command,
      probe: options.probe,
      home: options.home,
      platform: options.platform,
      now: options.now
    })
    return report.ok ? 0 : 1
  } catch (error) {
    if (error instanceof SmokeError && error.reported) return 1
    const message = error instanceof Error ? error.message : 'The smoke failed.'
    io.stderr(redactString(message))
    return 1
  }
}
