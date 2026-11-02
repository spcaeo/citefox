import type { DemoSnapshot } from '../../src/renderer/demo/snapshot'

/**
 * Cleans the recorded demo answers before they are saved (Docs/DEMO.md "Clean
 * output"): no folder paths, no key hints, no provider names, no emails.
 */

const DATA_FOLDER = '~/CiteFox'

/** Words that must never be in the published demo data (checked by bridge.test.ts too). */
export const BANNED_WORDS = /cloro|serp ?api|jina|claude|anthropic|codex|openai key|@gmail\.com/i

/** Provider words in the data the screens show, as customers should read them. */
const REPLACEMENTS: readonly [RegExp, string][] = [
  [/\bSerp ?API\b/gi, 'CiteFox searches'],
  [/\bcloro\b/gi, 'CiteFox searches'],
  [/\bJina( Reader)?\b/gi, 'CiteFox page reader'],
  [/\bClaude Code\b/gi, 'CiteFox AI'],
  [/\bClaude\b/gi, 'CiteFox AI'],
  [/\bAnthropic\b/gi, 'CiteFox AI'],
  [/\bCodex\b/gi, 'CiteFox AI']
]

/** Values (not keys) under these keys are replaced whole. */
const MASKED_KEYS = new Set(['hint', 'keychainRef', 'secret', 'email', 'userName'])

/**
 * An id the code switches on (`serpapi`, `claude-code`), never shown as text:
 * left as it is, like the same ids inside the app's own code.
 */
export function isIdentifier(value: string): boolean {
  return /^[a-z0-9_.:-]+$/.test(value)
}

function scrubString(value: string, folder: string): string {
  let out = value.split(folder).join(DATA_FOLDER)
  out = out.replace(/\/(tmp|home|Users)\/[^\s"']+/g, DATA_FOLDER)
  if (isIdentifier(out)) return out
  for (const [pattern, words] of REPLACEMENTS) out = out.replace(pattern, words)
  return out
}

function walk(value: unknown, folder: string, key: string | null): unknown {
  if (typeof value === 'string') {
    if (key !== null && MASKED_KEYS.has(key)) return key === 'hint' ? '••••' : ''
    return scrubString(value, folder)
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, folder, null))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, folder, k)])
    )
  }
  return value
}

export function scrubSnapshot(snapshot: DemoSnapshot, folder: string): DemoSnapshot {
  const entries = Object.fromEntries(
    Object.entries(snapshot.entries).map(([channel, list]) => [
      channel,
      list.map((entry) => ({ args: entry.args, result: walk(entry.result, folder, null) }))
    ])
  )
  return { ...snapshot, entries }
}
