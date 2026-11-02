import { useCallback, useMemo } from 'react'
import { useQueryList } from '../../utils/queryState'
import { hiddenKinds, MARKER_KINDS, type MarkerKind } from './markers'

/** Marker kinds hidden on this screen's charts, kept in the URL as `marks.hide`. */
export function useMarkerToggles(): {
  hidden: ReadonlySet<MarkerKind>
  toggle: (kind: MarkerKind) => void
} {
  const [items, setItems] = useQueryList('marks.hide')
  const hidden = useMemo(() => hiddenKinds(items), [items])
  const toggle = useCallback(
    (kind: MarkerKind) => {
      const next = new Set(hidden)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      setItems(MARKER_KINDS.filter((item) => next.has(item)))
    },
    [hidden, setItems]
  )
  return { hidden, toggle }
}
