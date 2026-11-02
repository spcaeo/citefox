import { useCallback, useMemo, useState } from 'react'
import type { PageCheck } from './ListHeader'

export interface Selection {
  keys: ReadonlySet<string>
  isSelected: (key: string) => boolean
  toggle: (key: string) => void
  /** Header checkbox state for the rows on this page. */
  pageCheck: PageCheck
  togglePage: () => void
  set: (keys: Iterable<string>) => void
  clear: () => void
}

/** A selection the caller keeps (such as in the URL): the keys and where changes go. */
export interface ControlledSelection {
  value: readonly string[]
  onChange: (keys: readonly string[]) => void
}

/**
 * Row selection by key. Keys of rows that are no longer passed in drop out, so a
 * removed row never stays "selected" behind the bulk bar. With `controlled`
 * the caller keeps the keys and every change goes through its `onChange`.
 */
export function useSelection(
  allKeys: readonly string[],
  pageKeys: readonly string[],
  controlled?: ControlledSelection
): Selection {
  const [own, setOwn] = useState<ReadonlySet<string>>(new Set())
  const value = controlled?.value
  const onChange = controlled?.onChange
  const outside = useMemo(() => (value === undefined ? null : new Set(value)), [value])
  const raw = outside ?? own
  const setRaw = useCallback(
    (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
      if (onChange === undefined || outside === null) setOwn(update)
      else onChange([...update(outside)])
    },
    [onChange, outside]
  )
  const keys = useMemo(() => {
    if (raw.size === 0) return raw
    const present = new Set(allKeys)
    const kept = [...raw].filter((key) => present.has(key))
    return kept.length === raw.size ? raw : new Set(kept)
  }, [raw, allKeys])

  const toggle = useCallback(
    (key: string) => {
      setRaw((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [setRaw]
  )

  const onPage = pageKeys.filter((key) => keys.has(key)).length
  const pageCheck: PageCheck = onPage === 0 ? 'none' : onPage === pageKeys.length ? 'all' : 'some'

  const togglePage = useCallback(() => {
    setRaw((current) => {
      const next = new Set(current)
      const all = pageKeys.every((key) => next.has(key))
      for (const key of pageKeys) {
        if (all) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }, [pageKeys, setRaw])

  return {
    keys,
    isSelected: (key) => keys.has(key),
    toggle,
    pageCheck,
    togglePage,
    set: (next) => setRaw(() => new Set(next)),
    clear: () => setRaw(() => new Set())
  }
}
