import type { JSX, ReactNode } from 'react'
import type { PageBlockKind } from '@shared/ipc'
import type { BlockDiffItem } from '@shared/page-diff'
import { pluralize } from '@shared/pluralize'
import { foldDiff, type DiffRow } from './model'
import '../fixes/todo/pageEdit/pageEdit.css'

/**
 * Two reads of a page as one calm document, in the Page edits look: removed text
 * struck through in red, new text on a light highlight, each block in its own
 * type size. Inline shows one column; side by side lines the old read up with
 * the new one. "Changes only" folds long unchanged runs.
 */
export function DiffView({
  items,
  view,
  all,
  fromLabel,
  toLabel,
  onShowAll
}: {
  items: readonly BlockDiffItem[]
  view: 'inline' | 'side'
  /** The whole page, or changes with a little context. */
  all: boolean
  fromLabel: string
  toLabel: string
  onShowAll: () => void
}): JSX.Element {
  const rows = foldDiff(items, all)
  if (view === 'side') {
    return (
      <div className="pc-side" role="table" aria-label="The page before and after">
        <div className="pc-side-row pc-side-head" role="row">
          <span role="columnheader">{fromLabel}</span>
          <span role="columnheader">{toLabel}</span>
        </div>
        {rows.map((row, index) =>
          row.kind === 'fold' ? (
            <Fold key={`f${index}`} row={row} onShowAll={onShowAll} side />
          ) : (
            <div key={index} className="pc-side-row" role="row">
              <div className="pc-side-cell" role="cell">
                {row.item.before !== null && row.item.op !== 'added' ? (
                  <Block kind={row.item.kind} mark={row.item.op === 'same' ? null : 'cut'}>
                    {row.item.before}
                  </Block>
                ) : null}
              </div>
              <div className="pc-side-cell" role="cell">
                {row.item.after !== null && row.item.op !== 'removed' ? (
                  <Block kind={row.item.kind} mark={row.item.op === 'same' ? null : 'add'}>
                    {row.item.after}
                  </Block>
                ) : null}
              </div>
            </div>
          )
        )}
      </div>
    )
  }
  return (
    <article className="pe-doc pc-doc" aria-label="What changed on the page">
      {rows.map((row, index) =>
        row.kind === 'fold' ? (
          <Fold key={`f${index}`} row={row} onShowAll={onShowAll} />
        ) : (
          <InlineItem key={index} item={row.item} />
        )
      )}
    </article>
  )
}

function InlineItem({ item }: { item: BlockDiffItem }): JSX.Element {
  if (item.op === 'same') return <Block kind={item.kind}>{item.after ?? ''}</Block>
  if (item.op === 'removed') {
    return (
      <Block kind={item.kind} mark="cut">
        {item.before ?? ''}
      </Block>
    )
  }
  if (item.op === 'added') {
    return (
      <Block kind={item.kind} mark="add">
        {item.after ?? ''}
      </Block>
    )
  }
  return (
    <>
      <Block kind={item.kind} mark="cut">
        {item.before ?? ''}
      </Block>
      <Block kind={item.kind} mark="add">
        {item.after ?? ''}
      </Block>
    </>
  )
}

/** One block in the page's own type size, struck (`cut`) or highlighted (`add`). */
function Block({
  kind,
  mark = null,
  children
}: {
  kind: PageBlockKind
  mark?: 'cut' | 'add' | null
  children: ReactNode
}): JSX.Element {
  const text =
    mark === 'cut' ? (
      <del className="pe-text pe-cut">
        <span className="sr-only">Removed: </span>
        {children}
      </del>
    ) : mark === 'add' ? (
      <ins className="pe-text pe-add">
        <span className="sr-only">Added: </span>
        {children}
      </ins>
    ) : (
      <span className="pe-text">{children}</span>
    )
  return (
    <div
      className={`pe-row pc-row pe-${kind}${mark ? ` pc-row-${mark}` : ''}`}
      data-op={mark ?? 'same'}
    >
      {text}
    </div>
  )
}

function Fold({
  row,
  onShowAll,
  side = false
}: {
  row: Extract<DiffRow, { kind: 'fold' }>
  onShowAll: () => void
  side?: boolean
}): JSX.Element {
  const label = `${pluralize(row.count, 'unchanged block')}${row.section ? ` in ${row.section}` : ''}`
  const button = (
    <button
      type="button"
      className="pc-fold-button"
      onClick={onShowAll}
      aria-label={`Show the whole page (${label} hidden)`}
    >
      … {label}
    </button>
  )
  if (!side) return <div className="pc-fold">{button}</div>
  return (
    <div className="pc-fold pc-fold-side" role="row">
      <div role="cell">{button}</div>
    </div>
  )
}
