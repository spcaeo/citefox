import type { ListColumn } from '../../ui/listGrid/types'
import { AskSparkle } from './AskSparkle'
import type { SparkleTarget } from './questions'

/**
 * A narrow ListGrid column holding each row's ✦ (shown on row hover or
 * focus). Add it last, before the row menu:
 *
 *   columns={[...columns, askColumn((row) => ({ kind: 'question', id: row.id, label: row.text }))]}
 */
export function askColumn<Row>(
  target: (row: Row) => SparkleTarget | null,
  questions?: (row: Row) => readonly string[] | undefined
): ListColumn<Row> {
  return {
    id: 'ask',
    label: 'Ask CiteFox',
    hideLabel: true,
    width: 36,
    align: 'end',
    cellClassName: 'ai-spark-cell',
    render: (row) => {
      const about = target(row)
      if (about === null) return null
      const lines = questions?.(row)
      return <AskSparkle target={about} {...(lines ? { questions: lines } : {})} size="xs" />
    }
  }
}
