import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseHelpFile, type HelpTopic } from './parse'

/**
 * Where the help files are, and the parsed topics. The build copies
 * `Docs/help/*.md` to `out/main/help` (electron.vite.config.ts), which ships
 * inside app.asar with the rest of `out/**`; main reads it next to its own
 * bundle. A dev run from the repo also finds `Docs/help` itself. No folder,
 * an empty folder or an unreadable file is not an error: Ask CiteFox then
 * answers without help sections.
 */

/** The electron-vite bundle is CommonJS, so `__dirname` is `out/main`; vitest runs ESM. */
declare const __dirname: string

/** Most files read; a stray folder of thousands is not help. */
const MAX_FILES = 120

/** Largest file read. */
const MAX_BYTES = 200_000

let override: string | null | undefined

/** Tests point the library at a fixture folder (null: no folder at all); undefined resets. */
export function setHelpDirectory(directory: string | null | undefined): void {
  override = directory
  cache = null
}

function moduleDirectory(): string {
  try {
    if (typeof __dirname === 'string' && __dirname.length > 0) return __dirname
  } catch {
    return process.cwd()
  }
  return process.cwd()
}

function resourcesPath(): string | undefined {
  const value: unknown = Reflect.get(process, 'resourcesPath')
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The first folder that holds a `.md` file, or null. */
export function resolveHelpDirectory(): string | null {
  if (override !== undefined) return override
  const here = moduleDirectory()
  const candidates = [
    join(here, 'help'),
    // A split chunk sits one folder below out/main.
    join(here, '..', 'help'),
    join(here, '..', '..', 'Docs', 'help'),
    join(here, '..', '..', '..', 'Docs', 'help'),
    join(process.cwd(), 'Docs', 'help')
  ]
  const resources = resourcesPath()
  if (resources !== undefined) candidates.push(join(resources, 'help'))
  return candidates.find((candidate) => markdownFiles(candidate).length > 0) ?? null
}

function markdownFiles(directory: string): string[] {
  try {
    if (!existsSync(directory)) return []
    return readdirSync(directory)
      .filter((name) => name.endsWith('.md') && !name.startsWith('_') && name !== 'README.md')
      .sort()
      .slice(0, MAX_FILES)
  } catch {
    return []
  }
}

let cache: { key: string; topics: HelpTopic[] } | null = null

/** Every help topic, parsed once and read again only when a file changes. */
export function loadHelpTopics(directory: string | null = resolveHelpDirectory()): HelpTopic[] {
  if (directory === null) return []
  const files = markdownFiles(directory)
  const stamps = files.map((name) => {
    try {
      const stat = statSync(join(directory, name))
      return { name, stamp: `${name}:${stat.mtimeMs}:${stat.size}`, size: stat.size }
    } catch {
      return { name, stamp: `${name}:gone`, size: -1 }
    }
  })
  const key = `${directory}|${stamps.map((item) => item.stamp).join('|')}`
  if (cache?.key === key) return cache.topics
  const topics: HelpTopic[] = []
  for (const { name, size } of stamps) {
    if (size < 0 || size > MAX_BYTES) continue
    try {
      const topic = parseHelpFile(name.slice(0, -3), readFileSync(join(directory, name), 'utf8'))
      if (topic !== null && topic.sections.length > 0) topics.push(topic)
    } catch {
      // An unreadable file is left out; the others still answer.
    }
  }
  cache = { key, topics }
  return topics
}
