/**
 * Runs `action` once, `waitMs` after the last call to `schedule`. `flush` runs a waiting
 * action now (for example when a window closes); `cancel` drops it.
 */
export interface Debounced {
  schedule(): void
  flush(): void
  cancel(): void
}

export function debounce(action: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): boolean => {
    if (timer === null) return false
    clearTimeout(timer)
    timer = null
    return true
  }
  return {
    schedule() {
      clear()
      timer = setTimeout(() => {
        timer = null
        action()
      }, waitMs)
    },
    flush() {
      if (clear()) action()
    },
    cancel() {
      clear()
    }
  }
}
