import { useLayoutEffect, useMemo, type JSX, type RefObject } from 'react'
import { tokenizeTemplate, type TemplateToken } from '../utils/highlight'

/**
 * The template text with `{{ variables }}` and `{# comments #}` highlighted
 * (FR-26.2). The read view is a focusable `<pre>`. While editing, a plain
 * textarea sits over a highlight layer: the textarea keeps its own text, so
 * selection, screen readers and spell check behave as usual, and the layer only
 * tints the tokens behind it.
 */

const TOKEN_CLASS: Readonly<Record<TemplateToken['kind'], string>> = {
  text: '',
  variable: 'tpl-tok tpl-tok-var',
  unknown: 'tpl-tok tpl-tok-unknown',
  comment: 'tpl-tok tpl-tok-comment',
  error: 'tpl-tok tpl-tok-error'
}

const TOKEN_TITLE: Readonly<Record<TemplateToken['kind'], string | undefined>> = {
  text: undefined,
  variable: undefined,
  unknown: 'This step does not fill this variable. CiteFox will leave it blank.',
  comment: 'Comment. CiteFox leaves it out of the prompt.',
  error: 'Syntax error'
}

function Tokens({ body, kind }: { body: string; kind: string }): JSX.Element {
  const tokens = useMemo(() => tokenizeTemplate(body, kind), [body, kind])
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'text' ? (
          token.text
        ) : (
          <span key={index} className={TOKEN_CLASS[token.kind]} title={TOKEN_TITLE[token.kind]}>
            {token.text}
          </span>
        )
      )}
    </>
  )
}

export function HighlightedTemplate({
  body,
  kind,
  labelledBy
}: {
  body: string
  kind: string
  labelledBy: string
}): JSX.Element {
  return (
    <pre className="mono tpl-view tpl-code" role="region" tabIndex={0} aria-labelledby={labelledBy}>
      <Tokens body={body} kind={kind} />
    </pre>
  )
}

export function TemplateTextarea({
  body,
  kind,
  labelledBy,
  describedBy,
  textareaRef,
  onChange
}: {
  body: string
  kind: string
  labelledBy: string
  describedBy?: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (next: string) => void
}): JSX.Element {
  // The textarea grows with its text, so it never scrolls apart from the layer.
  useLayoutEffect(() => {
    const area = textareaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight + 2}px`
  }, [body, textareaRef])

  return (
    <div className="tpl-edit-wrap">
      <pre className="mono tpl-hl-layer" aria-hidden="true">
        <Tokens body={body} kind={kind} />
        {'\n'}
      </pre>
      <textarea
        ref={textareaRef}
        className="mono tpl-textarea tpl-code"
        rows={14}
        spellCheck={false}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        value={body}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
