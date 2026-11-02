import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Cascade layers keep a screen's rules ahead of the shared defaults no matter
 * which order Vite loads the stylesheets in (see styles.css). These checks
 * stop a new or edited stylesheet from falling out of that scheme.
 */
const ROOT = join(process.cwd(), 'src/renderer/src')
const ORDER = '@layer shared, results, screens, utilities;'
type Layer = 'shared' | 'results' | 'screens' | 'utilities'

/** Shared stylesheets outside styles/. Each is imported once, from styles.css. */
const SHARED = [
  'components/Markdown.css',
  'drill/drill.css',
  'usage/usage.css',
  'status/popover.css',
  'projects/projectsScreen/drillPopover.css',
  'assist/assist.css',
  'buildMenu/buildMenu.css',
  'ui/ui.css',
  'ui/kpi.css',
  'ui/chart/chart.css',
  'ui/chart/report-charts.css',
  'ui/layout.css',
  'ui/panels.css',
  'ui/controls.css',
  'ui/way-list.css',
  'ui/HelpFill/helpfill.css',
  'ui/list-grid.css',
  'ui/list-grid-tools.css',
  'ui/list-grid-tree.css',
  'ui/list-grid-pin.css',
  'ui/views.css',
  'ui/dropdown.css',
  'ui/Drawer/drawer.css'
]
const RESULTS = ['m3/m3-core.css', 'm3/m3-drills.css']
/** Files that only @import others. */
const AGGREGATORS = ['styles.css', 'm3/m3.css']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

const files = walk(ROOT)
const sheets = files.filter((file) => file.endsWith('.css')).map((file) => relative(ROOT, file))
const scripts = files.filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

function expectedLayers(rel: string): Layer[] {
  if (rel === 'styles/base.css') return ['shared', 'utilities']
  // Theme helpers are shared; the card tint utility (.ui-tint) must beat a card's own ground.
  if (rel === 'styles/theme.css') return ['shared', 'utilities']
  if (rel.startsWith('styles/') || SHARED.includes(rel)) return ['shared']
  if (RESULTS.includes(rel)) return ['results']
  return ['screens']
}

/** Top-level statements: `@layer x { … }` blocks are returned as their layer name. */
function topLevel(text: string): { blocks: string[]; loose: string[] } {
  const blocks: string[] = []
  const loose: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') {
      if (depth === 0) {
        const head = text.slice(start, index).trim()
        const layer = /^@layer ([\w-]+)$/.exec(head)
        if (layer?.[1]) blocks.push(layer[1])
        else loose.push(head)
      }
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) start = index + 1
    } else if (char === ';' && depth === 0) {
      const statement = text.slice(start, index).trim()
      if (statement !== ORDER.slice(0, -1) && !statement.startsWith('@import'))
        loose.push(statement)
      start = index + 1
    }
  }
  const rest = text.slice(start).trim()
  if (rest) loose.push(rest)
  return { blocks, loose }
}

/** Every selector in the sheet, normalized, with its layer. */
function selectors(rel: string): string[] {
  const out: string[] = []
  const pattern = /([^{}@;]+)\{[^{}]*\}/g
  for (const match of source(rel).matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const selector = part.trim().replace(/\s+/g, ' ')
      if (selector && !/^(from|to|[\d.]+%)$/.test(selector)) out.push(selector)
    }
  }
  return out
}

describe('stylesheet cascade layers', () => {
  it('finds the stylesheets', () => {
    expect(sheets.length).toBeGreaterThan(40)
  })

  it.each(sheets)('%s declares the layer order first', (rel) => {
    const text = source(rel).trim()
    expect(text.startsWith(ORDER)).toBe(true)
  })

  it.each(sheets.filter((rel) => !AGGREGATORS.includes(rel)))(
    '%s puts every rule in its layer',
    (rel) => {
      const { blocks, loose } = topLevel(source(rel))
      expect(loose).toEqual([])
      expect([...new Set(blocks)].sort()).toEqual(expectedLayers(rel).sort())
    }
  )

  it('imports every shared stylesheet from styles.css only', () => {
    const entry = source('styles.css')
    for (const rel of [...sheets.filter((name) => name.startsWith('styles/')), ...SHARED]) {
      expect(entry, rel).toContain(`@import './${rel}';`)
    }
    for (const file of scripts) {
      const text = readFileSync(file, 'utf8')
      for (const rel of SHARED) {
        const name = rel.split('/').pop() ?? rel
        expect(text, `${relative(ROOT, file)} imports ${rel}`).not.toMatch(
          new RegExp(`import '[^']*/${name.replace('.', '\\.')}'`)
        )
      }
    }
  })

  it('keeps each screen selector in one screen stylesheet', () => {
    const owners = new Map<string, Set<string>>()
    for (const rel of sheets.filter((name) => expectedLayers(name).includes('screens'))) {
      for (const selector of selectors(rel)) {
        const set = owners.get(selector) ?? new Set<string>()
        set.add(rel)
        owners.set(selector, set)
      }
    }
    const shared = [...owners]
      .filter(([, set]) => set.size > 1)
      .map(([selector, set]) => `${selector}: ${[...set].join(', ')}`)
    expect(shared).toEqual([])
  })
})
