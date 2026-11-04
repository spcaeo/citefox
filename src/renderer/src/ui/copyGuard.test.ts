import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard for the owner's copy rules (2026-10-21, 2026-10-25, 2026-11-03):
 *
 *  - ONE shared copy component. Every copy and open icon on a value goes through
 *    `ui/CopyText`, `ui/UrlText` or `ui/PathText` (all built on `ui/useCopyFeedback`).
 *    A screen must not build its own copy icon, so a one-off cannot creep back in.
 *  - A form field (a box someone types into) has no copy icon.
 *  - A secret (password, key, token) is never copied out by a button.
 *
 * It reads the source of src/renderer/src and fails with the file and line.
 */

const ROOT = join(process.cwd(), 'src/renderer/src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test(-helper)?\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const FILES = sourceFiles(ROOT).map((path) => ({
  rel: relative(ROOT, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8')
}))

/** `ui/` holds the shared components themselves, so it may build copy icons. */
const inUi = (rel: string): boolean => rel.startsWith('ui/')

/**
 * The only file outside `ui/` allowed to touch the clipboard API. Screens that copy a
 * whole block (a brief, a draft, a list of URLs) call `copyText()` from it behind a
 * labelled button ("Copy brief"); that is a button with words, not a copy icon on a value.
 */
const CLIPBOARD_ALLOW = new Set(['components/clipboard.ts'])

function offenders(test: (rel: string) => boolean, pattern: RegExp): string[] {
  const found: string[] = []
  for (const { rel, text } of FILES) {
    if (!test(rel)) continue
    text.split('\n').forEach((line, at) => {
      if (pattern.test(line)) found.push(`${rel}:${at + 1}  ${line.trim()}`)
    })
  }
  return found
}

describe('one shared copy component (owner rule, 2026-11-03)', () => {
  it('only components/clipboard.ts talks to the clipboard API', () => {
    const found = offenders(
      (rel) => !CLIPBOARD_ALLOW.has(rel),
      /navigator\.clipboard|clipboard\.(writeText|write)\b|execCommand\(\s*['"]copy['"]/
    )
    expect(found).toEqual([])
  })

  it('no screen draws its own copy icon button', () => {
    // An aria-label that starts with Copy/Copied, a UiIcon named copy, or the shared
    // copy classes: all belong to ui/CopyText, ui/UrlText and ui/PathText only.
    const own = offenders(
      (rel) => !inUi(rel),
      /aria-label=\{?\s*[`'"](Copy|Copied)\b|<UiIcon\s+name=\{?\s*['"]copy['"]|ui-url-copy|ui-url-btn|data-copy-text/
    )
    expect(own).toEqual([])
  })

  it('an icon-only copy button (IconButton with the copy icon) lives in ui/ only', () => {
    const own = offenders((rel) => !inUi(rel), /<IconButton[^>]*\sicon=\{?\s*['"]copy['"]/)
    expect(own).toEqual([])
  })

  it('a copy action with words ("Copy brief") may exist, but must use copyText from the one helper', () => {
    // Every file outside ui/ that imports a copy helper imports the shared one.
    const wrong = offenders(
      (rel) => !inUi(rel),
      /import\s[^;]*\b(copyText|useCopyFeedback)\b[^;]*from\s+['"](?!(\.\.?\/)+(components\/clipboard|ui|ui\/useCopyFeedback)['"])/
    )
    expect(wrong).toEqual([])
  })
})

describe('no copy icon on a form field or a secret (owner rule, 2026-11-03)', () => {
  it('ui/SecretField.tsx has no copy button, copy helper or clipboard code', () => {
    const field = FILES.find((file) => file.rel === 'ui/SecretField.tsx')
    expect(field).toBeDefined()
    const text = field?.text ?? ''
    expect(text).not.toMatch(/copyText|CopyText|UrlText|PathText|useCopyFeedback|clipboard/i)
    expect(text).not.toMatch(/['"`]Copy\b/)
    expect(text).not.toMatch(/name=['"]copy['"]|icon=\{?['"]copy['"]/)
  })

  it('no shared copy component is given a secret (password, key, token) as its value', () => {
    // `<CopyText text={...secret...}>`, `<UrlText url={...token...}>`, `<PathText path=...>`.
    // maskedKey / hint are the masked form of a key and are secrets too.
    const SECRET_WORD = /password|passcode|secret|token|api[-_]?key|maskedKey|keyHint/i
    const found: string[] = []
    for (const { rel, text } of FILES) {
      if (inUi(rel)) continue
      for (const match of text.matchAll(/<(CopyText|UrlText|PathText)\b[\s\S]*?\/?>/g)) {
        const tag = match[0].split('\n').slice(0, 6).join(' ')
        const value = /\b(?:text|url|path)=\{([^}]*)\}/.exec(tag)?.[1] ?? ''
        if (SECRET_WORD.test(value)) found.push(`${rel}  ${tag.trim().slice(0, 100)}`)
      }
    }
    expect(found).toEqual([])
  })

  it('no file draws a SecretField and a copy icon for the same value', () => {
    // A form that has a SecretField may use CopyText for other values (a host name), but
    // never for a field whose name says it is the secret.
    const found: string[] = []
    for (const { rel, text } of FILES) {
      if (inUi(rel) || !text.includes('<SecretField')) continue
      if (/<(CopyText|UrlText)\b[^>]*(password|apiKey|secret)/i.test(text)) found.push(rel)
    }
    expect(found).toEqual([])
  })

  it('no text input or text area is wrapped with a copy component', () => {
    const found: string[] = []
    for (const { rel, text } of FILES) {
      if (inUi(rel)) continue
      for (const match of text.matchAll(
        /<(CopyText|UrlText|PathText)\b[^>]*>([\s\S]{0,400}?)<\/\1>/g
      )) {
        if (/<(input|textarea)\b/.test(match[2] ?? '')) found.push(rel)
      }
    }
    expect(found).toEqual([])
  })
})

describe('the guard itself works', () => {
  it('flags a hand-built copy button and a raw clipboard call', () => {
    const raw = 'await navigator.clipboard.writeText(x)'
    const button = '<button aria-label="Copy the link">'
    expect(/navigator\.clipboard/.test(raw)).toBe(true)
    expect(/aria-label=\{?\s*[`'"](Copy|Copied)\b/.test(button)).toBe(true)
    expect(/aria-label=\{?\s*[`'"](Copy|Copied)\b/.test('<input aria-label="Search">')).toBe(false)
  })

  it('reads the real source tree', () => {
    expect(FILES.length).toBeGreaterThan(500)
    expect(FILES.some((file) => file.rel === 'ui/CopyText.tsx')).toBe(true)
  })
})
