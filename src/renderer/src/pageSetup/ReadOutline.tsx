import { useMemo, type JSX } from 'react'
import type { PageReadResult } from '@shared/ipc'
import { useDrill } from '../drill'
import { navigateHash, pageHash } from '../shell/routes'
import { useQueryChoice } from '../utils/queryState'
import { Chip, EmptyState, ListGrid, SectionHead, type ListColumn, type MenuItem } from '../ui'
import { promptItemsDrill } from './drills'
import { outlineLabel } from './labels'
import type { PromptContext } from './readContext'
import { PromptCount } from './readDrills'
import { faqPromptIds, sectionPromptIds } from './readMatch'

type OutlineFilter = 'all' | 'h2' | 'h3' | 'table'

/** The outline filter is `?outline=<level>` in the route; All has none. */
const OUTLINE_FILTERS: readonly OutlineFilter[] = ['all', 'h2', 'h3', 'table']

const SECTION_NOTE =
  'Questions whose coverage row or mapped page element points at this part of the page. Select one to see its AI Overview.'
const FAQ_NOTE =
  'Questions whose coverage row or mapped page element points at this FAQ. Select one to see its AI Overview.'

interface OutlineRow {
  index: number
  level: PageReadResult['outline'][number]['level']
  text: string
  table: boolean
  ids: readonly string[]
}

interface FaqRow {
  index: number
  question: string
  typo: string | null
  ids: readonly string[]
}

function drillCopy(
  id: string,
  title: string,
  description: string
): {
  id: string
  title: string
  description: string
} {
  return { id, title, description }
}

/** The menu line that opens a row's prompts, or none when no prompt matches. */
function promptsItem(
  context: PromptContext,
  copy: { id: string; title: string; description: string },
  ids: readonly string[],
  open: ReturnType<typeof useDrill>['open']
): MenuItem[] {
  const prompts = context.prompts
  if (!prompts || ids.length === 0) return []
  return [
    {
      id: 'prompts',
      label: `Show the ${ids.length === 1 ? 'prompt' : `${ids.length} questions`}`,
      icon: 'eye',
      onSelect: () => open(promptItemsDrill(copy, prompts, ids, context.scope))
    }
  ]
}

/**
 * The outline as a list grid: level, heading and the prompts that use each
 * section. The segmented filter shows H2s, H3s or tables; each count opens
 * exactly those prompts.
 */
export function ReadOutline({
  result,
  context
}: {
  result: PageReadResult
  context: PromptContext
}): JSX.Element {
  const [filter, setFilter] = useQueryChoice('outline', OUTLINE_FILTERS, 'all')
  const { open } = useDrill()
  const prompts = context.prompts
  const all = useMemo<OutlineRow[]>(
    () =>
      result.outline.map((entry, index) => ({
        index,
        level: entry.level,
        text: entry.text,
        table: entry.table,
        ids: sectionPromptIds(entry.text, prompts ?? [], context.matrix)
      })),
    [result.outline, prompts, context.matrix]
  )
  const rows = all.filter((row) =>
    filter === 'all' ? true : filter === 'table' ? row.table : row.level === filter
  )
  const copy = (row: OutlineRow): ReturnType<typeof drillCopy> =>
    drillCopy(`read:section:${row.index}`, `Questions that use “${row.text}”`, SECTION_NOTE)
  const columns: readonly ListColumn<OutlineRow>[] = [
    {
      id: 'level',
      label: 'Level',
      width: 72,
      render: (row) => <Chip size="sm">{outlineLabel(row.level)}</Chip>
    },
    {
      id: 'heading',
      label: 'Heading',
      width: 'fill',
      minWidth: 200,
      render: (row) => (
        <span className={row.level === 'h3' ? 'rd-outline-text rd-h3' : 'rd-outline-text'}>
          {row.text}
          {row.table ? <span className="rd-faint"> (table)</span> : null}
        </span>
      )
    },
    {
      id: 'prompts',
      label: 'Questions',
      width: 112,
      numeric: true,
      sort: (row) => row.ids.length,
      render: (row) => (
        <PromptCount
          context={context}
          id={`read:section:${row.index}`}
          title={`Questions that use “${row.text}”`}
          description={SECTION_NOTE}
          ids={row.ids}
        />
      )
    }
  ]
  return (
    <div className="rd-block">
      <SectionHead id="read-outline-h" title="Outline" />
      <ListGrid<OutlineRow>
        label="Outline"
        noun={['heading', 'headings']}
        rows={rows}
        rowKey={(row) => String(row.index)}
        rowLabel={(row) => `${outlineLabel(row.level)} ${row.text}`}
        columns={columns}
        search={{ text: (row) => row.text }}
        filter={{
          label: 'Show in the outline',
          value: filter,
          onChange: (value) => setFilter(value as OutlineFilter),
          options: [
            { value: 'all', label: 'All', count: all.length },
            { value: 'h2', label: 'H2 headings', count: result.h2Count },
            { value: 'h3', label: 'H3 headings', count: result.h3Count },
            { value: 'table', label: 'Tables', count: result.tableCount }
          ]
        }}
        rowMenu={(row) => [
          ...promptsItem(context, copy(row), row.ids, open),
          {
            id: 'gaps',
            label: 'Open Content gaps',
            icon: 'layers',
            onSelect: () => navigateHash(pageHash(context.scope.pageId ?? '', 'gaps'))
          }
        ]}
        pageSize="all"
        maxBodyHeight={440}
        empty={
          <EmptyState
            compact
            title="No H2 or H3 headings found"
            body="Pages with clear section headings are easier for Google to quote."
          />
        }
      />
    </div>
  )
}

/**
 * The FAQs as a list grid: each question, a typo flag when CiteFox spotted
 * one, and the prompts it answers.
 */
export function ReadFaqs({
  result,
  pageId,
  context
}: {
  result: PageReadResult
  pageId: string
  context: PromptContext
}): JSX.Element {
  const { open } = useDrill()
  const prompts = context.prompts
  const rows = useMemo<FaqRow[]>(
    () =>
      result.faqs.map((faq, index) => ({
        index,
        question: faq.question,
        typo: faq.typo ?? null,
        ids: faqPromptIds(faq.question, prompts ?? [], context.matrix)
      })),
    [result.faqs, prompts, context.matrix]
  )
  const copy = (row: FaqRow): ReturnType<typeof drillCopy> =>
    drillCopy(`read:faq:${row.index}`, `Questions this FAQ answers: “${row.question}”`, FAQ_NOTE)
  const columns: readonly ListColumn<FaqRow>[] = [
    {
      id: 'n',
      label: 'Number',
      hideLabel: true,
      width: 48,
      numeric: true,
      render: (row) => <span className="rd-faint">{row.index + 1}</span>
    },
    {
      id: 'question',
      label: 'Question',
      width: 'fill',
      minWidth: 220,
      render: (row) => (
        <span className="rd-faq">
          <span className="rd-outline-text">{row.question}</span>
          {row.typo ? (
            <Chip size="sm" tone="warn" label="Typo spotted">
              Typo: {row.typo}
            </Chip>
          ) : null}
        </span>
      )
    },
    {
      id: 'prompts',
      label: 'Questions',
      width: 112,
      numeric: true,
      sort: (row) => row.ids.length,
      render: (row) => (
        <PromptCount
          context={context}
          id={`read:faq:${row.index}`}
          title={`Questions this FAQ answers: “${row.question}”`}
          description={FAQ_NOTE}
          ids={row.ids}
        />
      )
    }
  ]
  return (
    <div className="rd-block">
      <SectionHead
        id="read-faqs-h"
        title={`FAQs found (${result.faqs.length})`}
        description="From FAQPage schema and the FAQs heading"
      />
      <ListGrid<FaqRow>
        label="FAQs"
        noun={['FAQ', 'FAQs']}
        rows={rows}
        rowKey={(row) => String(row.index)}
        rowLabel={(row) => `FAQ ${row.index + 1}`}
        columns={columns}
        search={rows.length > 8 ? { text: (row) => row.question } : undefined}
        rowMenu={(row) => [
          ...promptsItem(context, copy(row), row.ids, open),
          {
            id: 'gaps',
            label: row.typo ? 'Fix the typo: see page-wide fixes' : 'Open Content gaps',
            icon: row.typo ? 'pencil' : 'layers',
            onSelect: () => navigateHash(pageHash(pageId, 'gaps'))
          }
        ]}
        pageSize="all"
        maxBodyHeight={440}
        empty={
          <EmptyState
            compact
            title="No FAQs found on this page"
            body="A short FAQ section often answers buyer questions in the words they search with."
          />
        }
      />
    </div>
  )
}
