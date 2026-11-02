import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../components/errorText'

export interface Loaded<T> {
  value: T | null
  error: string | null
  loading: boolean
  reload: () => void
  /** Replace the value (an import's result) without loading again. */
  set: (value: T) => void
}

/** Loads `load()` when `key` changes; a stale answer for an older key is dropped. */
export function useLoaded<T>(key: string, load: () => Promise<T>, fallback: string): Loaded<T> {
  const [state, setState] = useState<{ key: string; value: T | null; error: string | null }>({
    key: '',
    value: null,
    error: null
  })
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    load().then(
      (value) => {
        if (live) setState({ key, value, error: null })
      },
      (cause: unknown) => {
        if (live) setState({ key, value: null, error: errorText(cause, fallback) })
      }
    )
    return () => {
      live = false
    }
    // `load` is a fresh closure every render; the key and the round say when to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round])
  const current = state.key === key
  return {
    value: current ? state.value : null,
    error: current ? state.error : null,
    loading: !current,
    reload: useCallback(() => {
      setState((previous) => ({ ...previous, key: '' }))
      setRound((value) => value + 1)
    }, []),
    set: useCallback((value: T) => setState({ key, value, error: null }), [key])
  }
}
