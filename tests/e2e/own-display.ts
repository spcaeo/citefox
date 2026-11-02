import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * One X display per Playwright worker (CITEFOX_E2E_OWN_DISPLAY=1, set by the Docker run).
 *
 * With one shared Xvfb, workers disturb each other: every window another worker opens or
 * closes can send this worker's page a real pointer leave or move (a diagnostic run caught
 * a mouseleave with no related target right after a copy tick, and widget drags that never
 * landed), and the clipboard is shared, so one test's copy could be read by another. A
 * private Xvfb per worker keeps pointer, focus and clipboard to that worker.
 *
 * Playwright loads the config in every worker, so this runs there: it starts `Xvfb :N`
 * (N from the worker's parallel index) once per worker process and points DISPLAY at it,
 * which every Electron launch inherits. The main runner process is left alone.
 */
export function startOwnDisplay(env: NodeJS.ProcessEnv = process.env): void {
  if (env.CITEFOX_E2E_OWN_DISPLAY !== '1') return
  const index = env.TEST_PARALLEL_INDEX
  if (index === undefined) return
  const number = 200 + Number(index)
  const display = `:${number}`
  if (env.DISPLAY === display) return
  const socket = `/tmp/.X11-unix/X${number}`
  // A server left by an earlier worker with the same index is reused.
  if (!existsSync(socket)) {
    const server = spawn(
      'Xvfb',
      [display, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-ac'],
      { stdio: 'ignore', detached: false }
    )
    process.once('exit', () => server.kill())
    const until = Date.now() + 10_000
    const pause = new Int32Array(new SharedArrayBuffer(4))
    while (!existsSync(socket)) {
      if (Date.now() > until) throw new Error(`Xvfb ${display} did not start`)
      Atomics.wait(pause, 0, 0, 50)
    }
  }
  env.DISPLAY = display
  delete env.XAUTHORITY
}
