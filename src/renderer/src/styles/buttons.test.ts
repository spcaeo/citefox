import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Docs/DESIGN-GUIDELINES.md §1: tool actions are icon only (`ui/IconButton` with
 * `tip`). A `<Button>` that draws a tool icon together with a word is only allowed
 * as the area's main action (`variant="primary"`).
 */
const ROOT = join(process.cwd(), 'src/renderer/src')

/** Icons that mean a tool action (download, copy, edit, settings…). */
const TOOL_ICONS = [
  'download',
  'file',
  'inbox',
  'copy',
  'refresh',
  'pencil',
  'settings',
  'sliders',
  'filter',
  'link',
  'upload',
  'printer',
  'mail',
  'table'
]

/**
 * TODO(design pass 2026-11-02): files owned by the other builders (Reports, Summary,
 * Questions, Topics, question page, Competitors, Citations) while they convert their
 * areas. This list must be EMPTY after the merge.
 */
const PENDING: string[] = []

/**
 * TODO(design pass 2026-11-02): hand-made `<input type="search">` in the other
 * builders' areas, waiting for `ui/SearchBox`. Must be EMPTY after the merge.
 */
const SEARCH_PENDING: string[] = []

/**
 * Searches that stay hand-made on purpose: each is a combobox or a menu filter that
 * needs a ref and ARIA wiring SearchBox does not take (the top bar's ⌘K search with
 * its result list, the project switcher's "Find project" inside its menu).
 */
const SEARCH_KEPT = ['shell/TopBarSearch.tsx', 'components/ProjectSwitcher.tsx']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

/** Index just past the `>` that closes the opening tag starting at `from`, and whether it self-closes. */
function openTagEnd(text: string, from: number): { end: number; selfClosing: boolean } {
  let depth = 0
  let quote: string | null = null
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0) {
      return { end: index + 1, selfClosing: text[index - 1] === '/' }
    }
  }
  return { end: text.length, selfClosing: true }
}

/** The value of `name=` in an opening tag: a "string" or a {expression}. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}=`).exec(tag)
  if (!match) return null
  const start = match.index + match[0].length
  const open = tag[start]
  if (open === '"' || open === "'") return tag.slice(start + 1, tag.indexOf(open, start + 1))
  if (open !== '{') return null
  let depth = 0
  for (let index = start; index < tag.length; index += 1) {
    if (tag[index] === '{') depth += 1
    else if (tag[index] === '}' && (depth -= 1) === 0) return tag.slice(start + 1, index)
  }
  return null
}

function toolIcon(tag: string): string | null {
  for (const name of ['icon', 'iconEnd']) {
    const value = attr(tag, name)
    if (value === null) continue
    for (const icon of TOOL_ICONS) {
      if (new RegExp(`(^|['"\`])${icon}($|['"\`])`).test(value.trim())) return icon
    }
  }
  return null
}

export interface Offence {
  file: string
  line: number
  icon: string
}

/** Every `<Button>` in `text` that draws a tool icon with visible text and is not primary. */
export function offences(file: string, text: string): Offence[] {
  const found: Offence[] = []
  const pattern = /<(?:Link)?Button(?=[\s>])/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const { end, selfClosing } = openTagEnd(text, match.index)
    const tag = text.slice(match.index, end)
    const icon = toolIcon(tag)
    if (!icon || selfClosing) continue
    const variant = attr(tag, 'variant')
    if (variant === 'primary') continue
    const close = text.slice(end).search(/<\/(?:Link)?Button>/)
    const children = text
      .slice(end, close === -1 ? end : end + close)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    if (!children.trim()) continue
    found.push({ file, line: text.slice(0, match.index).split('\n').length, icon })
  }
  return found
}

/** Lines with a hand-made `<input type="search">` (use `ui/SearchBox`). */
export function searchInputs(file: string, text: string): Offence[] {
  const found: Offence[] = []
  const pattern = /<input(?=[\s>])/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const { end } = openTagEnd(text, match.index)
    if (attr(text.slice(match.index, end), 'type') !== 'search') continue
    found.push({ file, line: text.slice(0, match.index).split('\n').length, icon: 'search' })
  }
  return found
}

describe('tool buttons are icon only (DESIGN-GUIDELINES §1)', () => {
  it('finds an icon+word tool Button and skips primary and icon-only ones', () => {
    const sample = [
      '<Button icon="download" onClick={go}>Download</Button>',
      '<Button variant="primary" icon="refresh">Run check</Button>',
      '<Button icon={copied ? "check" : "copy"}>{label}</Button>',
      '<Button icon="plus">Add</Button>',
      '<Button icon="pencil" aria-label="Edit" />'
    ].join('\n')
    expect(offences('x.tsx', sample)).toEqual([
      { file: 'x.tsx', line: 1, icon: 'download' },
      { file: 'x.tsx', line: 3, icon: 'copy' }
    ])
  })

  it('no non-primary Button pairs a tool icon with a word', () => {
    const files = walk(ROOT)
      .filter((path) => path.endsWith('.tsx') && !/\.test\.tsx$/.test(path))
      .map((path) => relative(ROOT, path))
    const found = files
      .filter((rel) => !PENDING.includes(rel))
      .flatMap((rel) => offences(rel, readFileSync(join(ROOT, rel), 'utf8')))
      .map(
        (o) => `${o.file}:${o.line} (${o.icon}) — use <IconButton icon="${o.icon}" label="…" tip />`
      )
    expect(found).toEqual([])
  })

  it('every search outside ui/ is the shared SearchBox (DESIGN-GUIDELINES §0)', () => {
    expect(
      searchInputs('x.tsx', '<a />\n<input\n  type="search"\n/>\n<input type="text" />')
    ).toEqual([{ file: 'x.tsx', line: 2, icon: 'search' }])
    const found = walk(ROOT)
      .filter((path) => path.endsWith('.tsx') && !/\.test\.tsx$/.test(path))
      .map((path) => relative(ROOT, path))
      .filter((rel) => !rel.startsWith('ui/'))
      .filter((rel) => !SEARCH_PENDING.includes(rel) && !SEARCH_KEPT.includes(rel))
      .flatMap((rel) => searchInputs(rel, readFileSync(join(ROOT, rel), 'utf8')))
      .map((o) => `${o.file}:${o.line} — use <SearchBox label="Search …" /> from ui`)
    expect(found).toEqual([])
  })

  it('the allow-lists only name files that still need them', () => {
    const files = new Set(walk(ROOT).map((path) => relative(ROOT, path)))
    const listed = [...PENDING, ...SEARCH_PENDING, ...SEARCH_KEPT]
    expect(listed.filter((rel) => !files.has(rel))).toEqual([])
    // A file that was fixed must leave the list, so the list only ever shrinks.
    const clean = (rel: string, check: typeof offences): boolean =>
      check(rel, readFileSync(join(ROOT, rel), 'utf8')).length === 0
    expect(PENDING.filter((rel) => clean(rel, offences))).toEqual([])
    expect(SEARCH_PENDING.filter((rel) => clean(rel, searchInputs))).toEqual([])
  })
})
