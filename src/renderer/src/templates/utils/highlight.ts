import { isVariableForKind } from '@shared/domain'

/**
 * Tokens for the highlighted template view (FR-26.2). The scan follows
 * `@shared/template-syntax`: `{{ name }}` is a variable, `{# ... #}` a comment,
 * `{% ... %}` and anything else malformed inside braces is an error. A name the
 * step does not fill (`templateVariablesFor(kind)`) is a warning. Nothing is
 * evaluated, and the scan is one forward pass with `indexOf`.
 */

export type TokenKind = 'text' | 'variable' | 'unknown' | 'comment' | 'error'

export interface TemplateToken {
  kind: TokenKind
  text: string
  /** The trimmed name inside `{{ }}`, for variables and unknown names. */
  name?: string
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/
const CLOSERS = { '{': '}}', '%': '%}', '#': '#}' } as const

export function tokenizeTemplate(body: string, kind: string): TemplateToken[] {
  const tokens: TemplateToken[] = []
  let text = ''
  let index = 0
  const flush = (): void => {
    if (text.length > 0) tokens.push({ kind: 'text', text })
    text = ''
  }
  while (index < body.length) {
    const open = body.indexOf('{', index)
    if (open === -1) break
    const marker = body[open + 1]
    if (marker !== '{' && marker !== '%' && marker !== '#') {
      text += body.slice(index, open + 1)
      index = open + 1
      continue
    }
    text += body.slice(index, open)
    flush()
    const close = CLOSERS[marker]
    const end = body.indexOf(close, open + 2)
    if (end === -1) {
      tokens.push({ kind: 'error', text: body.slice(open) })
      index = body.length
      break
    }
    const span = body.slice(open, end + close.length)
    tokens.push(spanToken(marker, span, body.slice(open + 2, end), kind))
    index = end + close.length
  }
  text += body.slice(index)
  flush()
  return tokens
}

/** Names inside `{{ }}` that this step does not fill, in first-seen order. */
export function unknownVariables(body: string, kind: string): string[] {
  const names: string[] = []
  for (const token of tokenizeTemplate(body, kind)) {
    if (token.kind === 'unknown' && token.name && !names.includes(token.name)) {
      names.push(token.name)
    }
  }
  return names
}

export function hasTemplateError(body: string, kind: string): boolean {
  return tokenizeTemplate(body, kind).some((token) => token.kind === 'error')
}

export function variableToken(name: string): string {
  return `{{ ${name} }}`
}

function spanToken(
  marker: '{' | '%' | '#',
  span: string,
  inner: string,
  kind: string
): TemplateToken {
  if (inner.includes('{{') || inner.includes('{%') || inner.includes('{#')) {
    return { kind: 'error', text: span }
  }
  if (marker === '#') return { kind: 'comment', text: span }
  if (marker === '%') return { kind: 'error', text: span }
  const name = inner.trim()
  if (!NAME.test(name)) return { kind: 'error', text: span }
  return { kind: isVariableForKind(kind, name) ? 'variable' : 'unknown', text: span, name }
}
