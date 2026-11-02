import { useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type JSX } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import type { PluggableList } from 'unified'
import type { BrandLens } from '@shared/brand-mentions'
import { Markdown } from '../Markdown'
import { CiteChips } from './CiteChips'
import { citeKind, foldPlan, type CiteKind, type ScoredSource } from './model'
import { normalizeAnswer } from './normalize'
import { CITES_CLASS, readCites, remarkAnswer } from './remarkAnswer'
import './answerView.css'

type SpanProps = JSX.IntrinsicElements['span'] & ExtraProps
type TableProps = JSX.IntrinsicElements['table'] & ExtraProps

/**
 * A full AI answer (Google's AI Overview, ChatGPT, Perplexity …) laid out the
 * way the engine showed it, from the markdown cloro stored: section headings,
 * lists, real tables, rules, and the sources after each sentence as site chips.
 * The brand and the own site are marked in yellow and own-site chips stand
 * out. A long answer folds after about 16 lines, unless the owner is named or
 * cited below that, so the part that matters is never hidden.
 */
export function AnswerView({
  markdown,
  sources = [],
  lens = null,
  baseLevel = 3
}: {
  markdown: string
  /** The scored sources of this answer, for the own and competitor chips. */
  sources?: readonly ScoredSource[]
  /** Brand names and the own site, marked in yellow. Null marks nothing. */
  lens?: BrandLens | null
  /** Page heading level a markdown `#` and a section title become. */
  baseLevel?: number
}): JSX.Element | null {
  const text = useMemo(() => normalizeAnswer(markdown), [markdown])
  const plan = useMemo(() => foldPlan(text, sources, lens), [text, sources, lens])
  const plugins = useMemo<PluggableList>(() => [[remarkAnswer, { lens }]], [lens])
  const components = useMemo<Components>(() => {
    const kindOf = (url: string): CiteKind => citeKind(url, sources, lens)
    return {
      span: ({ className, children, ...rest }: SpanProps) => {
        if (className?.split(' ').includes(CITES_CLASS)) {
          return <CiteChips cites={readCites(dataOf(rest, 'data-cites'))} kindOf={kindOf} />
        }
        return <span className={className}>{children}</span>
      },
      table: ({ children }: TableProps) => (
        // Focusable so a keyboard can scroll a wide table (axe scrollable-region-focusable).
        <div className="ans-table" role="region" aria-label="Table" tabIndex={0}>
          <table>{children}</table>
        </div>
      )
    }
  }, [sources, lens])
  const [open, setOpen] = useState(plan.startOpen)
  const [fits, setFits] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()
  const folded = plan.foldable && !open && !fits

  // The estimate is in lines of markdown; the window may show it all after all.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !plan.foldable || open) return
    if (body.scrollHeight > 0 && body.scrollHeight <= body.clientHeight + 1) setFits(true)
  }, [plan.foldable, open, text])

  // A link or table tabbed to under the fold opens the answer, so focus is never hidden.
  function onFocus(event: FocusEvent<HTMLDivElement>): void {
    const body = bodyRef.current
    if (!folded || !body) return
    if (event.target.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom) {
      setOpen(true)
    }
  }

  if (text === '') return null
  return (
    <div className="ans">
      <div
        id={bodyId}
        ref={bodyRef}
        className={folded ? 'ans-body is-folded' : 'ans-body'}
        onFocus={onFocus}
      >
        <Markdown baseLevel={baseLevel} plugins={plugins} components={components}>
          {text}
        </Markdown>
      </div>
      {plan.foldable && !fits ? (
        <button
          type="button"
          className="ans-more"
          aria-expanded={!folded}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {folded ? 'Show full answer' : 'Show less'}
          <Chevron up={!folded} />
        </button>
      ) : null}
    </div>
  )
}

function dataOf(props: object, name: string): unknown {
  return (props as Record<string, unknown>)[name]
}

function Chevron({ up }: { up: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
