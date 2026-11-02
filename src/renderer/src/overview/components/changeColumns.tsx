import type { OverviewQuestion } from '@shared/ipc'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { ChangeCell, columnsFit, fitColumns, type ChangeTone, type ListColumn } from '../../ui'
import { changeText, changeTone } from '../compare'
import { changeHref, positionText, sourceText, youLabel } from '../model'
import { SourceCell, YouChip } from './changeCells'

/**
 * The grid's columns. `fromInLine` puts the source under the question (a muted
 * second line) when the From column is dropped to fit a narrow panel.
 */
function changeColumns(
  fromInLine: boolean,
  primary: string,
  questionMin = 200
): readonly ListColumn<OverviewQuestion>[] {
  return [
    {
      id: 'question',
      label: primary,
      width: 'fill',
      minWidth: questionMin,
      sort: (row) => row.text,
      render: (row) =>
        fromInLine ? (
          <span className="ov-q-stack">
            <a className="ov-q" href={changeHref(row)} title={row.text}>
              {row.text}
            </a>
            <span className="ov-q-from">
              <SourceCell row={row} />
            </span>
          </span>
        ) : (
          <a className="ov-q" href={changeHref(row)} title={row.text}>
            {row.text}
          </a>
        )
    },
    {
      id: 'from',
      label: 'From',
      width: 150,
      sort: (row) => sourceText(row.source),
      render: (row) => <SourceCell row={row} />
    },
    {
      id: 'before',
      label: 'Before',
      width: 112,
      sort: (row) => (row.before === null ? null : youLabel(row.before)),
      render: (row) =>
        row.before === null ? (
          <span className="ov-muted">—</span>
        ) : (
          <YouChip you={row.before.you} ownPage={row.before.ownPage} />
        )
    },
    {
      id: 'you',
      label: 'Now',
      width: 112,
      sort: (row) => youLabel(row),
      render: (row) => <YouChip you={row.you} ownPage={row.ownPage} />
    },
    {
      id: 'position',
      label: 'Place',
      hint: 'Where Google lists your page among the AI Overview’s sources now (#1 is first)',
      width: 64,
      align: 'end',
      sort: (row) => (row.you === 'cited' ? row.position : null),
      render: (row) => <span className="num">{positionText(row)}</span>
    },
    {
      id: 'change',
      label: 'Change',
      width: 92,
      sort: (row) => changeText(row.change),
      render: (row) => (
        <ChangeCell label={changeText(row.change)} tone={CHANGE_TONE[changeTone(row.change)]} />
      )
    }
  ]
}

const CHANGE_TONE: Readonly<Record<ReturnType<typeof changeTone>, ChangeTone>> = {
  ok: 'good',
  bad: 'bad',
  neutral: 'neutral'
}

/**
 * Dropped when the panel is narrow: From (shown under the question), Place,
 * then Change (Before → Now already says it). Before stays: Before → Now is
 * what this list is for.
 */
const NARROW_DROPS: readonly string[] = ['from', 'position', 'change']

const ASK = askColumn<OverviewQuestion>((row) => ({
  kind: 'question',
  id: row.promptId,
  label: row.text
}))

/**
 * The columns that fit `width`: with nothing to compare (a first check) Before
 * and Change are left out, and From when every row shares one source; then From
 * and Place, until the row fits. Before and Now always show when comparing: in
 * a very narrow panel the question column gives up width instead.
 */
export function fittedChangeColumns(
  comparing: boolean,
  width: number,
  options: {
    /** The first column's heading: "Search" when keywords are tracked too. */
    primary?: string
    /** Every row comes from one topic or page: no From column or subline repeating it. */
    oneSource?: boolean
  } = {}
): readonly ListColumn<OverviewQuestion>[] {
  const primary = options.primary ?? 'Question'
  const pick = (
    fromInLine: boolean,
    questionMin?: number
  ): readonly ListColumn<OverviewQuestion>[] => [
    ...changeColumns(fromInLine, primary, questionMin).filter(
      (column) =>
        (comparing || (column.id !== 'before' && column.id !== 'change')) &&
        !(options.oneSource && column.id === 'from')
    ),
    ASK
  ]
  const fitted = (questionMin?: number): readonly ListColumn<OverviewQuestion>[] => {
    if (options.oneSource) return fitColumns(pick(false, questionMin), NARROW_DROPS, width).columns
    const fit = fitColumns(pick(false, questionMin), NARROW_DROPS, width)
    if (!fit.dropped.includes('from')) return fit.columns
    const dropped = new Set(fit.dropped)
    return pick(true, questionMin).filter((column) => !dropped.has(column.id))
  }
  const columns = fitted()
  return width <= 0 || columnsFit(columns, width) ? columns : fitted(NARROW_QUESTION_MIN)
}

/** The question column's least width when the panel is too narrow for the rest. */
const NARROW_QUESTION_MIN = 140
