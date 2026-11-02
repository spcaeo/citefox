/**
 * The recorded answers the browser demo replays (Docs/DEMO.md).
 *
 * `npm run demo:record` runs the real IPC handlers on the TextBolt demo project
 * (the e2e reports seed plus the TextBolt topic), opens the demo build in a
 * headless window inside Docker and visits every screen. Each read the screens
 * make is stored here with its arguments and the handler's result.
 */

export interface DemoEntry {
  args: unknown
  result: unknown
}

export interface DemoSnapshot {
  version: 1
  /** When the snapshot was recorded (ISO). */
  recordedAt: string
  /** Channel → every recorded call, in the order the screens made them. */
  entries: Readonly<Record<string, readonly DemoEntry[]>>
}

export const EMPTY_SNAPSHOT: DemoSnapshot = { version: 1, recordedAt: '', entries: {} }

/** JSON with sorted object keys, so equal arguments give equal text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined'
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, sortKeys(record[key])])
    )
  }
  return value
}

/** Leaf values by path (`scope.id` → "page-1"), for matching close arguments. */
function leaves(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else if (value !== undefined) {
    out.set(prefix, JSON.stringify(value))
  }
  return out
}

function idLike(path: string): boolean {
  return /(^|\.)(id|[a-zA-Z]+Id|kind|report|engine|scope)$/.test(path)
}

/**
 * How close two argument lists are: matching ids count most, a differing id
 * costs most. Used when the exact arguments were never recorded, such as a
 * report asked for in another time zone.
 */
export function argumentScore(wanted: unknown, recorded: unknown): number {
  const a = leaves(wanted)
  const b = leaves(recorded)
  let score = 0
  for (const [path, value] of a) {
    const other = b.get(path)
    const weight = idLike(path) ? 4 : 1
    if (other === undefined) score -= weight / 2
    else if (other === value) score += weight
    else score -= weight
  }
  for (const path of b.keys()) if (!a.has(path)) score -= idLike(path) ? 2 : 0.5
  return score
}

/** The recorded result for these arguments: exact, else the closest call. Null: none. */
export function findEntry(
  snapshot: DemoSnapshot,
  channel: string,
  args: unknown
): DemoEntry | null {
  const list = snapshot.entries[channel]
  if (!list || list.length === 0) return null
  const key = stableJson(args)
  const exact = list.find((entry) => stableJson(entry.args) === key)
  if (exact) return exact
  let best: DemoEntry | null = null
  let bestScore = -Infinity
  for (const entry of list) {
    const score = argumentScore(args, entry.args)
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  return best
}
