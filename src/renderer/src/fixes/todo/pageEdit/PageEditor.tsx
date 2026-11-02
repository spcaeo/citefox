import { useLayoutEffect, useRef, type JSX } from 'react'
import type { PageEditResult } from '@shared/ipc'
import { Button, buttonClass, IconButton, MenuButton, UiIcon } from '../../../ui'
import { formatMoment } from '../../../utils/dates'
import {
  changeVerb,
  decide,
  decideAll,
  docRows,
  openCount,
  tableCells,
  typed,
  type DocRow,
  type EditState
} from '@shared/page-edit'

/**
 * The page as a document, Notion-style: one calm column, the page's own
 * headings and paragraphs, and the suggested changes in place. Struck text is
 * to remove, yellow text is to add. Each change keeps or undoes with one press
 * (on hover); any text can be typed over. The review controls sit in the rail
 * ({@link PageEditReview}).
 */
export function PageEditDoc({
  edit,
  edits,
  onEdits
}: {
  edit: PageEditResult
  edits: EditState
  onEdits: (next: EditState) => void
}): JSX.Element {
  const rows = docRows(edit, edits)
  return (
    <article className="pe-doc" data-testid="page-editor" aria-label={`Page edits for ${edit.url}`}>
      {rows.map((row) => (
        <Row
          key={row.key}
          row={row}
          onText={(text) => onEdits(typed(edits, row.key, text))}
          onKeep={(id) => onEdits(decide(edits, id, 'kept'))}
          onUndo={(id) => onEdits(decide(edits, id, 'undone'))}
        />
      ))}
    </article>
  )
}

/**
 * The rail's Review card: how many changes are left, what the marks mean, Keep
 * all, Download (HTML or Markdown) and Write again.
 */
export function PageEditReview({
  edit,
  edits,
  onEdits,
  onDownload,
  onRedo
}: {
  edit: PageEditResult
  edits: EditState
  onEdits: (next: EditState) => void
  /** Saves the page with its edits: HTML for a browser, Markdown for docs tools. */
  onDownload: (format: 'html' | 'md') => void
  onRedo: () => void
}): JSX.Element {
  const left = openCount(edit, edits)
  return (
    <div className="pe-review" data-testid="page-edit-review">
      <p className="pe-count" role="status">
        {left === 0
          ? 'All changes reviewed'
          : `${left} ${left === 1 ? 'change' : 'changes'} to review`}
      </p>
      <p className="pe-legend">
        <del>Struck</del> to remove · <ins>Yellow</ins> to add
      </p>
      {edit.summary ? <p className="pe-summary">{edit.summary}</p> : null}
      <div className="pe-actions">
        <MenuButton
          label="Download"
          width={200}
          align="start"
          items={[
            { id: 'html', label: 'HTML page', onSelect: () => onDownload('html') },
            { id: 'md', label: 'Markdown (.md)', onSelect: () => onDownload('md') }
          ]}
          trigger={({ ref, ...props }) => (
            <button ref={ref} type="button" className={buttonClass('primary', 'sm')} {...props}>
              <UiIcon name="download" size={14} />
              Download
              <UiIcon name="chevron-down" size={14} />
            </button>
          )}
        />
        {left > 0 ? (
          <Button size="sm" icon="check" onClick={() => onEdits(decideAll(edit, edits, 'kept'))}>
            Keep all
          </Button>
        ) : null}
      </div>
      <p className="pe-foot">
        Page read {formatMoment(edit.readAt)} · {edit.note.replace(/ · no searches$/u, '')}
        <br />
        <button type="button" className="pe-redo" onClick={onRedo}>
          Write again
        </button>
      </p>
    </div>
  )
}

function Row({
  row,
  onText,
  onKeep,
  onUndo
}: {
  row: DocRow
  onText: (text: string) => void
  onKeep: (changeId: string) => void
  onUndo: (changeId: string) => void
}): JSX.Element {
  // A rewrite's buttons and reason sit on its new text; the struck old text just shows what goes.
  const change =
    row.type === 'block'
      ? row.cut?.op === 'delete'
        ? row.cut
        : null
      : row.open
        ? row.change
        : null
  const mark = row.type === 'block' ? (row.cut ? 'cut' : null) : row.open ? 'add' : null
  const short = row.text.length > 48 ? `${row.text.slice(0, 48)}…` : row.text
  return (
    <div
      className={['pe-row', `pe-${row.kind}`, mark ? `pe-row-${mark}` : ''].join(' ').trim()}
      data-change={change?.id}
    >
      {row.kind === 'table' ? (
        <Table text={row.text} mark={mark} />
      ) : (
        <Editable
          text={row.text}
          className={mark ? `pe-text pe-${mark}` : 'pe-text'}
          label={row.kind}
          onText={onText}
        />
      )}
      {change ? (
        <span className="pe-change">
          <IconButton
            icon="check"
            size="sm"
            label={`Keep: ${changeVerb(change)} “${short}”`}
            onClick={() => onKeep(change.id)}
          />
          <IconButton
            icon="x"
            size="sm"
            label={`Undo: ${changeVerb(change)} “${short}”`}
            onClick={() => onUndo(change.id)}
          />
        </span>
      ) : null}
      {change?.why ? <p className="pe-why">{change.why}</p> : null}
    </div>
  )
}

/**
 * Text typed over in place. The DOM holds the text while someone types, so a
 * render never moves the caret; the new text is kept when focus leaves.
 */
function Editable({
  text,
  className,
  label,
  onText
}: {
  text: string
  className: string
  label: string
  onText: (text: string) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (node !== null && document.activeElement !== node && node.textContent !== text) {
      node.textContent = text
    }
  }, [text])
  return (
    <div
      ref={ref}
      className={className}
      contentEditable="plaintext-only"
      role="textbox"
      aria-multiline="true"
      aria-label={LABEL[label] ?? 'Paragraph'}
      tabIndex={0}
      spellCheck
      onBlur={(event) => {
        const next = (event.currentTarget.textContent ?? '').trim()
        if (next !== text) onText(next)
      }}
    />
  )
}

const LABEL: Record<string, string> = {
  h1: 'Page title',
  h2: 'Heading',
  h3: 'Subheading',
  h4: 'Subheading',
  li: 'List item',
  quote: 'Quote',
  code: 'Code'
}

function Table({ text, mark }: { text: string; mark: string | null }): JSX.Element {
  const [head, ...rest] = tableCells(text)
  if (head === undefined) return <pre className="pe-text">{text}</pre>
  return (
    <div className={mark ? `pe-table pe-${mark}` : 'pe-table'}>
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rest.map((cells, index) => (
            <tr key={index}>
              {cells.map((cell, at) => (
                <td key={at}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
