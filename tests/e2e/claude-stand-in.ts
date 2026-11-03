import { chmod, writeFile } from 'node:fs/promises'

/**
 * The fake `claude` the e2e apps find on PATH. Mac and Linux: a shell script that runs the
 * node shim. Windows: `claude.cmd`, which the app starts through cmd.exe like any batch file
 * (src/main/providers/windows-cmd.ts). `base` is the path without an extension; the real
 * path is returned. With no shim, the stand-in fails at once (exit 1).
 */
export async function writeClaudeStandIn(base: string, shim: string | null): Promise<string> {
  if (process.platform === 'win32') {
    const file = `${base}.cmd`
    const body = shim === null ? '@exit /b 1\r\n' : `@node "${shim}" %*\r\n`
    await writeFile(file, body)
    return file
  }
  const body =
    shim === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\nexec node ${JSON.stringify(shim)} "$@"\n`
  await writeFile(base, body)
  await chmod(base, 0o755)
  return base
}
