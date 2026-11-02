import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, DARK, hexOf, LIGHT, luminance, plain, SEPIA } from './themeColours.test-helper'

/**
 * Token lint over every stylesheet in the renderer: v2 tokens only
 * (styles/tokens.css), no retired v1 name, no raw colour (hex, rgb(), hsl()),
 * and no `var(--…)` that nothing defines. tokens.css is where the colours are
 * written down, so it alone may hold them. A file listed in HEX_ALLOWED may
 * keep the literals it names, each with a reason; keep that list short.
 */
const HEX_ALLOWED: Record<string, readonly string[]> = {
  // Sponsor brand colours are the sponsors' own, not CiteFox tokens (SPONSORS.md).
  'styles/sponsors.css': [
    '#0a0a0a',
    '#13213a',
    '#d4af37',
    '#e6c65a',
    '#ffd400',
    '#ffe04d',
    '#fffcf5',
    'rgba(212,175,55,0.35)',
    'rgba(255,252,245,0.86)'
  ]
}

/** A colour written out: hex, or an rgb()/hsl() function (spaces left out). */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g

function colourLiterals(value: string): string[] {
  return [...value.matchAll(COLOUR_LITERAL)].map((match) =>
    match[0].replace(/\s+/g, '').toLowerCase()
  )
}

/**
 * The retired v1 names (the old tokens.css "Part 2"): every name in these
 * families, plus a few single names. None may come back.
 */
const RETIRED_FAMILY =
  /^--(color|text|leading|weight|tracking|space|radius|size|shadow|sidebar-pad|main-pad)-/
const RETIRED_NAMES = new Set(['--font-sans', '--font-mono', '--main-gap', '--z-menu'])

function retired(name: string): boolean {
  return RETIRED_FAMILY.test(name) || RETIRED_NAMES.has(name)
}

const ROOT = join(process.cwd(), 'src/renderer/src')

function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...filesIn(rel, keep))
    else if (keep(entry.name)) out.push(rel)
  }
  return out
}

const SHEETS = filesIn('', (name) => name.endsWith('.css')).sort()
const SOURCES = filesIn('', (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))

/** Comments left out, so `#main` in a note or a selector is not a colour. */
/** Declaration values only (selectors left out). */
function values(text: string): string[] {
  return [...plain(text).matchAll(/[\w-]+\s*:\s*([^;{}]+)/g)].map((match) => match[1] ?? '')
}

/** Custom properties some stylesheet defines, or a component sets inline (`'--kpi-cols'`). */
function definedNames(): Set<string> {
  const names = new Set<string>()
  for (const file of SHEETS) {
    const text = plain(readFileSync(join(ROOT, file), 'utf8'))
    for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1] ?? '')
  }
  for (const file of SOURCES) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const match of text.matchAll(/['"`](--[\w-]+)['"`]\s*[:\]]/g)) names.add(match[1] ?? '')
  }
  return names
}

const DEFINED = definedNames()

describe('v2 token lint', () => {
  it('checks every stylesheet in the renderer', () => {
    expect(SHEETS.length).toBeGreaterThan(80)
    expect(SHEETS).toContain('styles/shell.css')
    expect(SHEETS).toContain('styles/sidebar.css')
  })

  it('tokens.css defines only v2 names', () => {
    const text = plain(readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8'))
    const names = [...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1] ?? '')
    expect(names.length).toBeGreaterThan(90)
    expect(names.filter(retired)).toEqual([])
  })

  it.each(Object.keys(HEX_ALLOWED))('%s (hex allow-list) exists', (file) => {
    expect(SHEETS).toContain(file)
  })

  it.each(SHEETS)('%s uses v2 tokens only', (file) => {
    const allowed = file === 'styles/tokens.css' ? null : (HEX_ALLOWED[file] ?? [])
    const found: string[] = []
    for (const value of values(readFileSync(join(ROOT, file), 'utf8'))) {
      for (const match of value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
        const name = match[1] ?? ''
        if (retired(name)) found.push(`v1 token ${name}`)
        else if (!match[2] && !DEFINED.has(name)) found.push(`undefined token ${name}`)
      }
      if (allowed === null) continue
      for (const literal of colourLiterals(value)) {
        if (!allowed.includes(literal)) found.push(`raw colour ${literal}`)
      }
    }
    expect(found, file).toEqual([])
  })

  it('components never read a retired v1 name', () => {
    const found: string[] = []
    for (const file of SOURCES) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (retired(match[1] ?? '')) found.push(`${file}: ${match[1]}`)
      }
    }
    expect(found).toEqual([])
  })
})

/** `--name: value` declarations of the first rule whose selector starts with `selector`. */
/** Tokens written as a colour (not only derived from another token with `var(…)`). */
function colourTokens(block: Map<string, string>): string[] {
  return [...block]
    .filter(([, value]) => colourLiterals(value).length > 0)
    .map(([name]) => name)
    .sort()
}

/** Text token on its background: every pair clears WCAG AA (4.5:1) in both themes. */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ['--ink', '--surface'],
  ['--ink', '--inset'],
  ['--ink', '--ground'],
  ['--ink-2', '--surface'],
  ['--ink-2', '--inset'],
  ['--ink-3', '--surface'],
  ['--ink-3', '--inset'],
  ['--ink-3', '--ground'],
  ['--fox-ink', '--surface'],
  ['--fox-ink', '--fox-tint'],
  ['--fox-deep', '--ground'],
  ['--on-fox', '--fox'],
  ['--on-action', '--action'],
  ['--on-action', '--action-hover'],
  ['--on-action', '--action-press'],
  ['--action-ink', '--surface'],
  ['--action-ink', '--inset'],
  ['--action-ink', '--ground'],
  ['--action-ink-hover', '--surface'],
  ['--action-ink-hover', '--inset'],
  ['--action-ink-hover', '--ground'],
  ['--ok', '--surface'],
  ['--ok', '--ok-tint'],
  ['--warn', '--surface'],
  ['--warn', '--warn-tint'],
  ['--bad', '--surface'],
  ['--bad', '--bad-tint'],
  ['--info', '--surface'],
  ['--info', '--info-tint'],
  ['--on-solid', '--ok'],
  ['--on-solid', '--bad'],
  ['--on-solid', '--bad-ink'],
  ['--on-ink', '--ink'],
  ['--on-spruce', '--spruce'],
  ['--spruce-ink', '--spruce'],
  ['--spruce-ink-2', '--spruce'],
  ['--ink', '--mark'],
  ['--ink', '--mark-tint'],
  ['--ink', '--sponsor-ground'],
  ['--ink-3', '--sponsor-ground'],
  ...['sky', 'sand', 'lilac', 'mint', 'rose'].flatMap((tint) =>
    ['--ink', '--ink-2', '--ink-3'].map((ink) => [ink, `--tint-${tint}`] as const)
  ),
  // Coloured text on a tinted card or header band: links, tones, the AI mark.
  ...[
    '--tint-sky',
    '--tint-sand',
    '--tint-lilac',
    '--tint-mint',
    '--tint-rose',
    '--fox-tint'
  ].flatMap((tint) =>
    [
      '--fox',
      '--fox-ink',
      '--fox-deep',
      '--action-ink',
      '--action-ink-hover',
      '--ok',
      '--warn',
      '--bad',
      '--info'
    ].map((ink) => [ink, tint] as const)
  ),
  ...['--fox', '--fox-ink', '--fox-deep', '--info'].map((ink) => [ink, '--inset'] as const)
]

/** The card tints' meanings: each alias and its line point at a defined token. */
const TINT_ALIASES = [
  'section-visibility',
  'section-site',
  'section-tracking',
  'section-setup',
  'tint-win',
  'tint-attention',
  'tint-ai'
]

describe('light and dark themes', () => {
  it('reads both colour blocks', () => {
    expect(LIGHT.size).toBeGreaterThan(60)
    expect(DARK.size).toBeGreaterThan(50)
  })

  it('gives every light colour token a dark value, and nothing else', () => {
    expect(colourTokens(LIGHT).filter((name) => !DARK.has(name))).toEqual([])
    expect([...DARK.keys()].filter((name) => !LIGHT.has(name))).toEqual([])
  })

  it('gives sepia a value for every token dark sets, and nothing else', () => {
    expect([...DARK.keys()].filter((name) => !SEPIA.has(name))).toEqual([])
    expect([...SEPIA.keys()].filter((name) => !DARK.has(name))).toEqual([])
  })

  it('keeps the sepia page warm and light and its sidebar dark', () => {
    for (const name of ['--ground', '--surface', '--inset']) {
      const [r, , b] = [1, 3, 5].map((at) => parseInt(hexOf(SEPIA, name).slice(at, at + 2), 16))
      expect(luminance(hexOf(SEPIA, name)), name).toBeGreaterThan(0.7)
      expect(r! - b!, `${name} is warm`).toBeGreaterThan(10)
    }
    expect(luminance(hexOf(SEPIA, '--spruce'))).toBeLessThan(0.05)
  })

  it('keeps the dark ground, surface, inset and sidebar dark and the ink light', () => {
    for (const name of ['--ground', '--surface', '--inset', '--spruce']) {
      expect(luminance(hexOf(DARK, name)), name).toBeLessThan(0.05)
    }
    expect(luminance(hexOf(DARK, '--ink'))).toBeGreaterThan(0.7)
  })

  it.each(TEXT_PAIRS)('%s on %s clears AA in every theme', (text, ground) => {
    expect(contrast(hexOf(LIGHT, text), hexOf(LIGHT, ground)), 'light').toBeGreaterThanOrEqual(4.5)
    expect(contrast(hexOf(DARK, text), hexOf(DARK, ground)), 'dark').toBeGreaterThanOrEqual(4.5)
    expect(contrast(hexOf(SEPIA, text), hexOf(SEPIA, ground)), 'sepia').toBeGreaterThanOrEqual(4.5)
  })

  it('makes each area marker on the sidebar visible (3:1 on spruce and its hover)', () => {
    for (const area of ['visibility', 'site', 'tracking', 'setup']) {
      const mark = `--section-${area}-mark`
      for (const [theme, block] of [
        ['light', LIGHT],
        ['dark', DARK],
        ['sepia', SEPIA]
      ] as const) {
        for (const ground of ['--spruce', '--spruce-2']) {
          expect(
            contrast(hexOf(block, mark), hexOf(block, ground)),
            `${theme} ${mark} on ${ground}`
          ).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('gives every card tint alias a ground and a line that resolve to tokens', () => {
    for (const alias of TINT_ALIASES) {
      for (const name of [`--${alias}`, `--${alias}-line`]) {
        const target = /^var\((--[\w-]+)\)$/.exec(LIGHT.get(name) ?? '')?.[1]
        expect(target, name).toBeDefined()
        expect(LIGHT.has(target ?? ''), `${name} → ${target}`).toBe(true)
      }
    }
  })

  it('never builds a shadow from --ink (it turns light in dark and would glow)', () => {
    const found: string[] = []
    for (const file of SHEETS) {
      for (const value of values(readFileSync(join(ROOT, file), 'utf8'))) {
        if (/\d+px[^,]*color-mix\([^)]*var\(--ink\)/.test(value)) found.push(`${file}: ${value}`)
      }
    }
    expect(found).toEqual([])
  })

  it('components write no colour literal (charts and inline styles read tokens)', () => {
    const found: string[] = []
    for (const file of SOURCES) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const match of text.matchAll(/(?:^|[^&\w/])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) {
        found.push(`${file}: ${match[0].trim()}`)
      }
    }
    expect(found).toEqual([])
  })
})
