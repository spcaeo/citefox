import { ProviderTimeoutError } from './errors'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Races `operation` against a timer. Aborts the signal so a transport can
 * stop work. The losing promise is caught so a late rejection is not unhandled.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  secrets?: readonly string[]
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ProviderTimeoutError(label, timeoutMs, secrets))
    }, timeoutMs)
  })
  const guarded = operation(controller.signal).catch((error: unknown) => {
    if (controller.signal.aborted) throw new ProviderTimeoutError(label, timeoutMs, secrets)
    throw error
  })
  try {
    return await Promise.race([guarded, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    void guarded.catch(() => undefined)
    void timeout.catch(() => undefined)
  }
}
