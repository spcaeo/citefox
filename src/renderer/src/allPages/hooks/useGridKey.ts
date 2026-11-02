import { useCallback, useState } from 'react'
import { presetParam } from '../utils/views'

/** Deep-link filters the grid starts from (`linkedPresets`), besides the preset; other values never reset it. */
const LINK_KEYS = ['folder', 'cluster', 'group', 'market'] as const

/** The deep-link part of the URL values, as one string. */
export function paramsKey(params: Readonly<Record<string, string>> | undefined): string {
  if (!params) return 'pages'
  const preset = presetParam(params)
  return [
    ...(preset === null ? [] : [`preset=${preset}`]),
    ...LINK_KEYS.filter((key) => params[key] !== undefined).map(
      (key) => `${key}=${params[key] ?? ''}`
    )
  ].join('&')
}

function hashParams(hash: string): Record<string, string> {
  const out: Record<string, string> = {}
  new URLSearchParams(hash.split('?')[1] ?? '').forEach((value, key) => {
    out[key] = value
  })
  return out
}

/**
 * The grid's React key: it starts over on its linked view when a deep link
 * changes (a tile, a cluster link), but not when the URL only catches up with
 * a view the grid wrote itself (`history.replaceState`), which the shell sees
 * later, when a drawer opens or closes. Without this, opening any drawer after
 * picking a view would rebuild the grid and drop the picked rows.
 */
export function useGridKey(params: Readonly<Record<string, string>> | undefined): {
  key: string
  written: (hash: string) => void
} {
  const linked = paramsKey(params)
  const [key, setKey] = useState(linked)
  const [seen, setSeen] = useState(linked)
  const [own, setOwn] = useState<string | null>(null)
  if (linked !== seen) {
    setSeen(linked)
    if (linked !== own) setKey(linked)
  }
  const written = useCallback((hash: string) => setOwn(paramsKey(hashParams(hash))), [])
  return { key, written }
}
