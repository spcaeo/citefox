import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode
} from 'react'
import type { GridCsvExport } from '../grid/types'
import { DrawerLevel } from '../shell/DrawerLevel'
import { closeDrawer, openDrawer, setDrawerParams, useDrawerStack } from '../shell/drawers'
import { Drawer } from '../ui'
import { formatSort, parseSort } from '../utils/queryState'
import { DrillDrawer } from './DrillDrawer'
import { TopicDrillDrawer } from './TopicDrillDrawer'
import { DrillContext, type DrillApi } from './context'
import { DrillRegistry } from './registry'
import type { DrillRequest } from './types'

/** How long a pasted drill link waits for its number to appear before saying it is gone. */
const RESOLVE_MS = 5000
const NO_PARAMS: Readonly<Record<string, string>> = {}

/**
 * Owns the one drill drawer. The shell wraps every screen in a host, so a
 * screen never draws two drawers at once. A host inside another host hands
 * its children to the outer one, so screens and harnesses can wrap
 * themselves and still share the shell's drawer.
 *
 * The open drill is on the URL (`drawer=drill&drill=<id>`, Docs/DRAWER.md):
 * Back closes it, Forward reopens it, and a copied link reopens it as soon as
 * the screen draws the number it belongs to. Its filter and search are on the
 * URL too (`drill.f`, `drill.q`, `drill.sort`). `resetKey` names the screen
 * (the shell passes the route): drills are remembered per screen, so Back to
 * a recent screen reopens its drill at once.
 */
export function DrillHost({
  children,
  exportCsv,
  resetKey
}: {
  children: ReactNode
  /** Tests only. Production writes CSV through `grid:exportCsv`. */
  exportCsv?: GridCsvExport
  resetKey?: string
}): JSX.Element {
  const outer = useContext(DrillContext)
  if (outer) return <>{children}</>
  return (
    <OwnHost exportCsv={exportCsv} resetKey={resetKey}>
      {children}
    </OwnHost>
  )
}

function OwnHost({
  children,
  exportCsv,
  resetKey
}: {
  children: ReactNode
  exportCsv: GridCsvExport | undefined
  resetKey: string | undefined
}): JSX.Element {
  const { stack } = useDrawerStack()
  const depth = stack.findIndex((entry) => entry.id === 'drill')
  const drillId = depth >= 0 ? (stack[depth]?.params.drill ?? null) : null
  const [registry] = useState(() => new DrillRegistry())
  const [opened, setOpened] = useState<DrillRequest | null>(null)
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setOpened(null)
  }
  // Idempotent: the numbers this screen draws register under its key.
  registry.setScreen(resetKey ?? '')
  const known = useSyncExternalStore(
    registry.subscribe,
    () => (drillId === null ? false : registry.get(drillId) !== null),
    () => false
  )
  const current =
    drillId === null ? null : opened?.id === drillId ? opened : known ? registry.get(drillId) : null

  const open = useCallback(
    (drill: DrillRequest) => {
      registry.register(drill)
      setOpened(drill)
      openDrawer('drill', { drill: drill.id })
    },
    [registry]
  )
  const close = useCallback(() => closeDrawer(depth >= 0 ? depth : undefined), [depth])
  const register = useCallback((drill: DrillRequest) => registry.register(drill), [registry])
  const api = useMemo<DrillApi>(
    () => ({ open, close, current, register }),
    [open, close, current, register]
  )

  return (
    <DrillContext.Provider value={api}>
      {children}
      {drillId === null || depth < 0 ? null : (
        <DrawerLevel depth={depth}>
          {current === null ? (
            <PendingDrill key={drillId} onClose={close} />
          ) : (
            <OpenDrill
              key={current.id}
              drill={current}
              depth={depth}
              params={stack[depth]?.params ?? NO_PARAMS}
              onClose={close}
              exportCsv={exportCsv}
            />
          )}
        </DrawerLevel>
      )}
    </DrillContext.Provider>
  )
}

/**
 * The open drill. Its filter, search and sort are on the URL (`drill.f`,
 * `drill.q`, `drill.sort`) so a copied link opens the same view: a filter is
 * a step Back undoes, typing and sorting rewrite the step in place.
 */
function OpenDrill({
  drill,
  depth,
  params,
  onClose,
  exportCsv
}: {
  drill: DrillRequest
  depth: number
  params: Readonly<Record<string, string>>
  onClose: () => void
  exportCsv: GridCsvExport | undefined
}): JSX.Element {
  const sortValue = params['drill.sort'] ?? null
  const sort = useMemo(() => parseSort(sortValue), [sortValue])
  const search = params['drill.q'] ?? ''
  const setSearch = (value: string): void =>
    setDrawerParams(depth, { 'drill.q': value === '' ? null : value })
  if (drill.kind === 'topic') {
    return (
      <TopicDrillDrawer
        drill={drill}
        onClose={onClose}
        closeOnLeave={false}
        grid={{
          searchValue: search,
          onSearchChange: setSearch,
          ...(sort.length > 0 ? { sort } : {}),
          onSortChange: (next) => setDrawerParams(depth, { 'drill.sort': formatSort(next) })
        }}
        {...(exportCsv ? { exportCsv } : {})}
      />
    )
  }
  return (
    <DrillDrawer
      drill={drill}
      onClose={onClose}
      closeOnLeave={false}
      filter={params['drill.f'] ?? 'all'}
      query={search}
      onFilter={(next) =>
        setDrawerParams(depth, { 'drill.f': next === 'all' ? null : next }, { push: true })
      }
      onQuery={setSearch}
      {...(exportCsv ? { exportCsv } : {})}
    />
  )
}

/**
 * A pasted drill link whose number is not on screen (yet): the greyed drawer
 * while the screen loads, then a plain note that the list is not here.
 */
function PendingDrill({ onClose }: { onClose: () => void }): JSX.Element {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setGone(true), RESOLVE_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Drawer
      id="drill"
      title="Rows behind this number"
      loading={!gone}
      onClose={onClose}
      footer={{ summary: gone ? null : 'Opening the list…' }}
    >
      <p className="drill-desc">
        This list is not on this screen any more. Open the number again to see the rows behind it.
      </p>
    </Drawer>
  )
}
