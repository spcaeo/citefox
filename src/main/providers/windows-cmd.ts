/**
 * Starting a `.cmd` / `.bat` file on Windows (npm installs Claude Code and Codex as
 * `claude.cmd` / `codex.cmd`). Since the 2024 Node security fix (CVE-2024-27980), `spawn`
 * refuses a batch file without a shell (EINVAL). CiteFox keeps `shell: false` and runs the
 * batch file through `cmd.exe /d /s /c` itself, escaping the command and every argument the
 * way cmd.exe reads them (the same rules as the widely used cross-spawn package), so an
 * argument cannot become a second command. Prompts still go on stdin, never in arguments.
 */

/** Characters cmd.exe treats specially; each is escaped with `^`. */
const META = /([()\][%!^"`<>&|;, *?])/g

export function isWindowsBatch(command: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command)
}

/** The command itself (a path to the .cmd file). */
export function escapeCmdCommand(command: string): string {
  return command.replace(META, '^$1')
}

/**
 * One argument: quoted for the program's own parser (backslashes before quotes doubled),
 * then every cmd.exe metacharacter escaped. An npm `.cmd` shim passes `%*` on to node, so
 * cmd.exe reads the line twice and needs the escape twice.
 */
export function escapeCmdArgument(arg: string, doubleEscape = true): string {
  let out = arg.replace(/(\\*)"/g, '$1$1\\"')
  out = out.replace(/(\\*)$/, '$1$1')
  out = `"${out}"`
  out = out.replace(META, '^$1')
  if (doubleEscape) out = out.replace(META, '^$1')
  return out
}

/** What to pass to spawn for a batch file: cmd.exe, its arguments, and verbatim mode. */
export function windowsBatchSpawn(
  command: string,
  args: readonly string[],
  comspec: string = process.env.ComSpec || 'cmd.exe'
): { file: string; args: string[]; windowsVerbatimArguments: true } {
  const line = [escapeCmdCommand(command), ...args.map((arg) => escapeCmdArgument(arg))].join(' ')
  return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true }
}

/**
 * An npm launcher (`claude.cmd`, made by npm's cmd-shim) ends with
 * `"%_prog%"  "%dp0%\node_modules\…\cli.js" %*`: it only runs node on a script. Starting
 * node on that script directly needs no cmd.exe and no escaping. Returns null for any
 * other batch file, which then goes through `windowsBatchSpawn`.
 */
export function npmShimTarget(
  cmdPath: string,
  text: string,
  exists: (path: string) => boolean
): { file: string; prefix: string[] } | null {
  const match = /"%~?dp0%?\\([^"%]+\.(?:c?js|mjs))"\s+%\*/i.exec(text)
  if (!match?.[1]) return null
  const dir = cmdPath.replace(/[\\/][^\\/]*$/, '')
  const script = `${dir}\\${match[1]}`
  if (!exists(script)) return null
  const bundledNode = `${dir}\\node.exe`
  return { file: exists(bundledNode) ? bundledNode : 'node', prefix: [script] }
}
