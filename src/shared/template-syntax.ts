/**
 * The generation-template syntax, shared by main (render) and the renderer (save checks).
 *
 * It is the small Nunjucks-compatible subset the three templates use, and nothing more:
 * - `{{ name }}` outputs a variable. Whitespace inside the braces is optional.
 * - `{{ a.b }}` is read as an unknown name and renders blank. It is never resolved.
 * - `{# ... #}` is a comment and renders nothing.
 * - `{% ... %}` tags and `{{ name | filter }}` filters are not supported.
 * - Anything else inside `{{ }}` (calls, brackets, strings, operators) is a syntax error.
 *
 * Nothing in a template is evaluated. A variable is looked up only as an own key of
 * the values object, so `{{ constructor }}` cannot reach a prototype. The scan is one
 * forward pass with `indexOf`, so a hostile body cannot make it backtrack.
 */

export type TemplateSyntaxIssue = 'syntax' | 'unsupported'

/** The message never contains the template body. */
export class TemplateSyntaxError extends Error {
  readonly issue: TemplateSyntaxIssue

  constructor(issue: TemplateSyntaxIssue) {
    super(issue === 'syntax' ? 'Template syntax error' : 'Unsupported template syntax')
    this.name = 'TemplateSyntaxError'
    this.issue = issue
  }
}

export type TemplatePart = { kind: 'text'; text: string } | { kind: 'variable'; name: string }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const DOTTED = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/
const CLOSERS = { '{': '}}', '%': '%}', '#': '#}' } as const

/** Throws `TemplateSyntaxError` on the first problem. */
export function parseTemplate(body: string): TemplatePart[] {
  return scan(body, false)
}

/**
 * Variable names in first-seen order, duplicates removed. Never throws: a malformed
 * span is skipped, so a stored template written before these rules still lists.
 */
export function templateNames(body: string): string[] {
  const names: string[] = []
  for (const part of scan(body, true)) {
    if (part.kind === 'variable' && !names.includes(part.name)) names.push(part.name)
  }
  return names
}

/** True for a plain `{{ name }}` identifier. A dotted name is never a value. */
export function isPlainName(name: string): boolean {
  return IDENTIFIER.test(name)
}

/** Fills each plain name from an own key of `values`. Anything else renders blank. */
export function renderTemplateParts(
  parts: readonly TemplatePart[],
  values: Readonly<Record<string, string | number>>
): string {
  let text = ''
  for (const part of parts) {
    if (part.kind === 'text') {
      text += part.text
      continue
    }
    if (!isPlainName(part.name) || !Object.prototype.hasOwnProperty.call(values, part.name)) {
      continue
    }
    const value: unknown = values[part.name]
    if (typeof value === 'string') text += value
    else if (typeof value === 'number' && Number.isFinite(value)) text += String(value)
  }
  return text
}

function scan(body: string, lenient: boolean): TemplatePart[] {
  const parts: TemplatePart[] = []
  let text = ''
  let index = 0
  while (index < body.length) {
    const open = body.indexOf('{', index)
    if (open === -1) break
    const marker = body[open + 1]
    if (marker !== '{' && marker !== '%' && marker !== '#') {
      text += body.slice(index, open + 1)
      index = open + 1
      continue
    }
    const close = CLOSERS[marker]
    const end = body.indexOf(close, open + 2)
    if (end === -1) {
      if (lenient) break
      throw new TemplateSyntaxError('syntax')
    }
    text += body.slice(index, open)
    index = end + close.length
    const expr = body.slice(open + 2, end)
    const problem = spanProblem(marker, expr)
    if (problem !== null) {
      if (lenient) continue
      throw new TemplateSyntaxError(problem)
    }
    if (marker !== '{') continue
    if (text.length > 0) parts.push({ kind: 'text', text })
    text = ''
    parts.push({ kind: 'variable', name: expr.trim() })
  }
  text += body.slice(index)
  if (text.length > 0) parts.push({ kind: 'text', text })
  return parts
}

function spanProblem(marker: '{' | '%' | '#', expr: string): TemplateSyntaxIssue | null {
  if (expr.includes('{{') || expr.includes('{%') || expr.includes('{#')) return 'syntax'
  if (marker === '#') return null
  if (marker === '%') return 'unsupported'
  const name = expr.trim()
  if (name.length === 0) return 'syntax'
  if (name.includes('|')) return 'unsupported'
  if (IDENTIFIER.test(name) || DOTTED.test(name)) return null
  return 'syntax'
}
