import type { JSX } from 'react'
import type { AioBlock, AioListItem, AioSegment } from '@shared/aio-overview'
import { blockPassageId, itemPassageId } from '@shared/aio-passages'
import { safeExternalUrl } from '../../../drill'
import { ListGrid, type ListColumn } from '../../../ui'
import { CitationChip } from './CitationChip'
import { Marked } from './Marked'
import { useCitations } from './model'

/**
 * Overview blocks in Google's order. Text is plain text nodes, never Markdown.
 * Each passage carries its id (`data-passage`, src/shared/aio-passages.ts), so the
 * insights card can point at it; brand and own-site mentions are marked in yellow.
 */
export function OverviewBlocks({
  blocks,
  parent = null
}: {
  blocks: readonly AioBlock[]
  /** The id of the block or item these blocks sit in. Null at the top. */
  parent?: string | null
}): JSX.Element {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} id={blockPassageId(parent, index)} />
      ))}
    </>
  )
}

function Block({ block, id }: { block: AioBlock; id: string }): JSX.Element {
  const { lens } = useCitations()
  switch (block.kind) {
    case 'heading':
      return (
        <h3 className="aio-h" data-passage={id}>
          <RichText parts={block.text} />
        </h3>
      )
    case 'paragraph':
      return (
        <p className="aio-p" data-passage={id}>
          <RichText parts={block.text} />
          <Cite refs={block.refs} />
        </p>
      )
    case 'list':
      return (
        <ul className="aio-ul">
          {block.items.map((item, index) => (
            <ListItem key={index} item={item} id={itemPassageId(id, index)} />
          ))}
        </ul>
      )
    case 'table':
      return <Table id={id} header={block.header} rows={block.rows} refs={block.refs} />
    case 'expandable':
      return (
        <details className="aio-expand" data-passage={id}>
          <summary>
            <Marked text={block.title} lens={lens} />
          </summary>
          <OverviewBlocks blocks={block.blocks} parent={id} />
        </details>
      )
  }
}

function ListItem({ item, id }: { item: AioListItem; id: string }): JSX.Element {
  const { lens } = useCitations()
  return (
    <li data-passage={id}>
      {item.label ? (
        <>
          <strong className="aio-label">
            <Marked text={item.label} lens={lens} />:
          </strong>
          {item.text.length > 0 ? ' ' : null}
        </>
      ) : null}
      <RichText parts={item.text} />
      <Cite refs={item.refs} />
      {item.children.length > 0 ? <OverviewBlocks blocks={item.children} parent={id} /> : null}
    </li>
  )
}

/** One row of a table in the overview, as Google laid it out. */
interface TableRow {
  index: number
  cells: readonly string[]
}

function Table({
  id,
  header,
  rows,
  refs
}: {
  id: string
  header: readonly string[]
  rows: readonly (readonly string[])[]
  refs: readonly number[]
}): JSX.Element {
  const { lens } = useCitations()
  // As many columns as hold any text: a trailing empty cell gets no column.
  const filled = (cells: readonly string[]): number =>
    cells.reduce((last, cell, index) => (cell.trim() ? index + 1 : last), 0)
  const width = Math.max(filled(header), ...rows.map(filled))
  const columns: ListColumn<TableRow>[] = Array.from({ length: width }, (_, index) => {
    const label = header[index] ?? ''
    return {
      id: `c${index}`,
      label: label || `Column ${index + 1}`,
      ...(label ? {} : { hideLabel: true }),
      width: 'fill',
      minWidth: 120,
      // Cells wrap as Google's do; the row grows to its tallest cell.
      wrap: true,
      render: (row: TableRow) => (
        <span className="aio-cell">
          <Marked text={row.cells[index] ?? ''} lens={lens} />
        </span>
      )
    }
  })
  const named = header.filter(Boolean).join(', ')
  return (
    <div className="aio-table-wrap" data-passage={id}>
      <ListGrid<TableRow>
        label={named ? `Table: ${named}` : 'Table in the overview'}
        noun={['row', 'rows']}
        rows={rows.map((cells, index) => ({ index, cells }))}
        rowKey={(row) => String(row.index)}
        rowLabel={(row) => `row ${row.index + 1}`}
        columns={columns}
        pageSize="all"
        rowAlign="start"
        empty={null}
      />
      {refs.length > 0 ? (
        <p className="aio-table-cite">
          <Cite refs={refs} />
        </p>
      ) : null}
    </div>
  )
}

function Cite({ refs }: { refs: readonly number[] }): JSX.Element | null {
  if (refs.length === 0) return null
  return (
    <>
      {' '}
      <CitationChip refs={refs} />
    </>
  )
}

function RichText({ parts }: { parts: readonly AioSegment[] }): JSX.Element {
  const { lens } = useCitations()
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case 'text':
            return <Marked key={index} text={part.text} lens={lens} />
          case 'bold':
            return (
              <strong key={index}>
                <Marked text={part.text} lens={lens} />
              </strong>
            )
          case 'code':
            return (
              <code key={index} className="aio-code">
                <Marked text={part.text} lens={lens} />
              </code>
            )
          case 'link': {
            const href = safeExternalUrl(part.href)
            return href ? (
              <a key={index} href={href} target="_blank" rel="noopener noreferrer">
                <Marked text={part.text} lens={lens} />
                <span className="sr-only"> (opens in your browser)</span>
              </a>
            ) : (
              <Marked key={index} text={part.text} lens={lens} />
            )
          }
        }
      })}
    </>
  )
}
