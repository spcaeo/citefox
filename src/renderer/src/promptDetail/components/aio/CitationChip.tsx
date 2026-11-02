import { useId, useState, type JSX, type KeyboardEvent } from 'react'
import { Chip } from '../../../ui'
import { KIND_TONE } from '../../constants'
import { sourceKind, sourceKindLabel } from '../../utils/model'
import { Marked } from './Marked'
import { SourceMark } from './SourceMark'
import { citationLabel, isOwnSource, sameRefs, useCitations, type SourceView } from './model'

/** Sources listed in the hover card before "+N more". */
const TIP_SOURCES = 3
/** Space kept between the hover card and the window edge. */
const TIP_GUTTER = 16

/**
 * Google's chain-link citation button after a sentence. Hover or focus shows
 * a card with the sources; a click marks them in the sources rail.
 */
export function CitationChip({ refs }: { refs: readonly number[] }): JSX.Element | null {
  const { sources, active, onCite, lens } = useCitations()
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const views = refs
    .map((index) => sources.get(index))
    .filter((view): view is SourceView => view !== undefined)
  if (views.length === 0) return null
  const extra = views.length - TIP_SOURCES

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <span
      className="aio-cite"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="aio-cite-btn"
        aria-label={citationLabel(views)}
        aria-describedby={open ? tipId : undefined}
        aria-pressed={sameRefs(active, refs)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onClick={() => onCite(refs)}
      >
        <LinkIcon />
      </button>
      {open ? (
        <span role="tooltip" id={tipId} className="aio-tip" ref={placeTip}>
          {views.slice(0, TIP_SOURCES).map((view) => (
            <span
              key={view.source.index}
              className={isOwnSource(view, lens) ? 'aio-tip-src is-own' : 'aio-tip-src'}
            >
              <span className="aio-tip-site">
                <SourceMark name={view.name} />
                <span className="aio-tip-name">
                  <Marked text={view.name} lens={lens} />
                </span>
                {isOwnSource(view, lens) ? <OwnChip view={view} /> : null}
              </span>
              {view.source.title ? (
                <span className="aio-tip-title">
                  <Marked text={view.source.title} lens={lens} />
                </span>
              ) : null}
              {view.source.snippet ? (
                <span className="aio-tip-snippet">
                  <Marked text={view.source.snippet} lens={lens} />
                </span>
              ) : null}
            </span>
          ))}
          {extra > 0 ? (
            <span className="aio-tip-more">
              +{extra} more {extra === 1 ? 'source' : 'sources'}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

/** The rail's This page / Own page chip, for an own-site source in the hover card. */
function OwnChip({ view }: { view: SourceView }): JSX.Element {
  const reference = view.reference
  return (
    <Chip size="sm" tone={KIND_TONE[reference ? sourceKind(reference) : 'own']}>
      {reference ? sourceKindLabel(reference) : 'Own page'}
    </Chip>
  )
}

/** Opens the card leftwards when it would run past the window's right edge. */
function placeTip(node: HTMLSpanElement | null): void {
  if (!node) return
  const room = document.documentElement.clientWidth - TIP_GUTTER
  node.classList.toggle('aio-tip-end', node.getBoundingClientRect().right > room)
}

/** Google's chain-link glyph. */
function LinkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
