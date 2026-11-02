import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The light and dark colour tokens of styles/tokens.css, read for tests, and
 * the WCAG contrast between two of them (tokens.test.ts, colourContrast.test.ts).
 */
export const RENDERER_ROOT = join(process.cwd(), 'src/renderer/src')

export function plain(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The custom properties of the first rule whose selector starts with `selector`. */
export function tokenBlock(selector: string, file = 'styles/tokens.css'): Map<string, string> {
  const text = plain(readFileSync(join(RENDERER_ROOT, file), 'utf8'))
  const start = text.indexOf(selector)
  if (start < 0) throw new Error(`${file} has no ${selector} rule`)
  const open = text.indexOf('{', start)
  const close = text.indexOf('}', open)
  const out = new Map<string, string>()
  for (const match of text.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1] ?? '', (match[2] ?? '').replace(/\s+/g, ' ').trim())
  }
  return out
}

export const LIGHT = tokenBlock(':root,\n  [data-theme] {')
export const DARK = tokenBlock(":root[data-theme='dark'],")
export const SEPIA = tokenBlock(":root[data-theme='sepia'],")

/** A token's hex in `block` (the light value when the theme leaves it as it is). */
export function hexOf(block: Map<string, string>, name: string): string {
  const value = block.get(name) ?? LIGHT.get(name) ?? ''
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value))
    throw new Error(`${name} is not a hex: ${value}`)
  return value.length === 4
    ? `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`
    : value
}

/**
 * A colour in `block` that may be a `var(--token)` chain (or a hex), followed
 * to its hex. `extra` holds a stylesheet's own custom properties first.
 */
export function resolveHex(
  block: Map<string, string>,
  value: string,
  extra: Map<string, string> = new Map()
): string {
  let current = value.trim()
  for (let step = 0; step < 8; step += 1) {
    const name = /^var\((--[\w-]+)\)$/.exec(current)?.[1]
    if (!name) break
    current = extra.get(name) ?? block.get(name) ?? LIGHT.get(name) ?? ''
  }
  return hexOf(new Map([['x', current]]), 'x')
}

export function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
