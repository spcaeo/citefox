import type { IpcInvokeChannel } from '@shared/ipc'

/**
 * Recording build only (`VITE_CITEFOX_DEMO_RECORD=1`, tests/demo/record.e2e.ts):
 * reads and quiet changes go to the recorder's server, which runs the real
 * handlers on the demo project and stores each answer for snapshot.json.
 */
export function recordingRemote(): (channel: IpcInvokeChannel, arg: unknown) => Promise<unknown> {
  return async (channel, arg) => {
    const response = await fetch('/__demo/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, arg })
    })
    const body = (await response.json()) as { ok: boolean; value?: unknown; message?: string }
    if (!body.ok) throw new Error(body.message ?? `${channel} failed`)
    return body.value
  }
}
