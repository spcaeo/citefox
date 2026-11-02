import type { QuestionRow, QuestionSource } from '@shared/ipc'
import type { DrillItem, DrillScope, ItemDrill } from '../../drill'
import { GOOGLE_WORDS, type ResultWords } from '../../ui/resultWords'
import { stageLabel } from '../clusters'
import { checkedText, type TopicLine } from './model'

/**
 * The Topics screen's drill-downs (REPORT-SPEC "Interaction model", NFR-14): each
 * number opens exactly the questions or topics it counts, so the drawer total is the
 * number clicked. A question opens Prompt detail on the check its result came from
 * (the page it was moved from, when it ran there).
 */

const SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: 'Latest check of each question',
  brand: '',
  domain: ''
}

const QUESTION_COLUMNS = [
  { id: 'result', label: 'Latest', width: '120px' },
  { id: 'checked', label: 'Checked', width: '96px' }
]

const RESULT_TEXT: Readonly<Record<QuestionRow['result'], string>> = {
  cited: 'Cited',
  named: 'Named, not cited',
  not_cited: 'Not cited',
  no_overview: 'No overview',
  error: 'Search failed',
  not_checked: 'Not checked'
}

/** One question: its latest check, or its previous one for a "previous" number. */
export function questionItem(
  row: QuestionRow,
  sources: ReadonlyMap<string, QuestionSource>,
  marketId: string | null,
  when: 'latest' | 'previous' = 'latest',
  words: ResultWords = GOOGLE_WORDS
): DrillItem {
  const source = sources.get(row.sourceId)?.name ?? ''
  const previous = when === 'previous' ? row.previous : null
  return {
    id: `${row.sourceId}|${row.promptId}`,
    primary: row.text,
    secondary: [source, stageLabel(row.stage)].filter(Boolean).join(' · '),
    target:
      previous !== null
        ? {
            kind: 'prompt',
            pageId: previous.pageId,
            promptId: previous.promptId,
            marketId,
            runId: previous.runId
          }
        : {
            kind: 'prompt',
            pageId: row.resultPageId ?? row.sourceId,
            promptId: row.resultPromptId ?? row.promptId,
            marketId,
            runId: row.runId
          },
    cells:
      previous !== null
        ? {
            result: previous.cited === true ? 'Cited' : previous.overview ? 'Not cited' : '—',
            checked: checkedText(previous.checkedAt)
          }
        : {
            result:
              row.result === 'no_overview' && words.engine ? words.none : RESULT_TEXT[row.result],
            checked: checkedText(row.checkedAt)
          },
    group: row.result
  }
}

/** The questions behind a number. `id` is the NFR-14 id on the clicked control. */
export function questionsDrill(input: {
  id: string
  title: string
  description: string
  rows: readonly QuestionRow[]
  sources: ReadonlyMap<string, QuestionSource>
  marketId: string | null
  when?: 'latest' | 'previous'
  /** The picked engine's words: "No answer" on ChatGPT. */
  words?: ResultWords
}): ItemDrill {
  return {
    kind: 'items',
    id: input.id,
    title: input.title,
    description: input.description,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: QUESTION_COLUMNS,
    items: input.rows.map((row) =>
      questionItem(row, input.sources, input.marketId, input.when ?? 'latest', input.words)
    ),
    note: 'Select a question to open its detail on that check.',
    scope: {
      ...SCOPE,
      checkDateLabel:
        input.when === 'previous' ? 'Previous check of each question' : SCOPE.checkDateLabel
    }
  }
}

/**
 * The target pages behind the "+8" next to the first one: the other 8, so the drawer
 * lists as many pages as the number says (the first is in the cell already).
 */
export function targetPagesDrill(line: TopicLine): ItemDrill {
  const first = line.targets[0]
  return {
    kind: 'items',
    id: `topics:${line.id}:targets`,
    title: `More target pages of ${line.name}`,
    description: `The own pages this topic’s questions should cite besides ${first?.path ?? 'the first one'}, most questions first.`,
    noun: ['target page', 'target pages'],
    primaryLabel: 'Page',
    columns: [{ id: 'questions', label: 'Questions', align: 'end', width: '96px' }],
    items: line.targets.slice(1).map((target) => ({
      id: target.url,
      primary: target.path,
      mono: true,
      url: target.url,
      target:
        target.pageId === null
          ? { kind: 'url', url: target.url }
          : { kind: 'page', pageId: target.pageId },
      cells: { questions: target.questions }
    })),
    note: 'Select a page to open it.',
    scope: SCOPE
  }
}
