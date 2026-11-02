import { useMemo, useRef, type JSX, type ReactNode } from 'react'
import type { EngineId, GridSortKey, TopicBand, TopicStage } from '@shared/domain'
import type {
  MoveDestination,
  QuestionRef,
  QuestionRow,
  QuestionSource,
  QuestionsList
} from '@shared/ipc'
import { AiSelection } from '../../assistant/context/AiSelection'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { EngineDots, EngineStatus } from '../../engines/EngineDots'
import {
  engineShortLabel,
  isAnswerFilter,
  statusRank,
  type EngineFilter,
  type StatusMap
} from '../../engines/model'
import { questionMenuItems } from '../../questionEdit'
import { refsOf } from '../../topics/clusters'
import {
  ListGrid,
  type FilterGroup,
  type ListBulkContext,
  type ListColumn,
  type ListEngineFilter,
  type ListFooterInfo,
  type MenuItem
} from '../../ui'
import { groupOf, groupOrder, stageSort, type TopicChoice } from '../grouping'
import { changeSort, countText, resultSort, sourceLabel, type QuestionsView } from '../model'
import { BulkActions, type BulkHandlers } from './BulkActions'
import {
  ChangeCell,
  InsteadCell,
  KindCell,
  QuestionText,
  ResultCell,
  SentimentCell,
  SourceCell,
  StageCell,
  TargetCell
} from './cells'
import { startDrag } from '../utils/drag'
import { DropZone } from './DropZone'
import { InlineQuestionEdit } from './InlineEdit'
import { rowRules } from './rowRules'
import { GroupMeta } from './GroupMeta'
import { questionsGroupDrill } from '../drills'
import { rowStatuses } from '../engineView'

/**
 * Left out first, in order, when the list is narrower than its row (each question's
 * detail has them). The engine dots go last, after every other column that can go.
 */
const NARROW_DROPS: readonly string[] = [
  'sentiment',
  'instead',
  'source',
  'stage',
  'target',
  'kind',
  'engines'
]

const NO_ENGINES: readonly EngineId[] = []
const NO_STATUSES: StatusMap = new Map()

/** What a row or the bulk bar can ask the screen to do. */
export interface QuestionRowActions extends BulkHandlers {
  onOpen: (row: QuestionRow) => void
  onEdit: (row: QuestionRow) => void
  onRecheckOne: (row: QuestionRow) => void
  onToggle: (row: QuestionRow) => void
  /** "Edit wording here": the row's text becomes a field. */
  onEditInline: (row: QuestionRow) => void
  onInlineSave: (row: QuestionRow, text: string) => void
  onInlineCancel: () => void
  onCopyText: (row: QuestionRow) => void
  /** Opens the move (or duplicate) drawer for one row. */
  onMoveOne: (row: QuestionRow, mode: 'move' | 'copy') => void
  onStageOne: (row: QuestionRow, stage: TopicStage | null) => void
  onRemoveOne: (row: QuestionRow) => void
  /** "Sort into topics with AI" on the "Not in a topic" header. */
  onSort: () => void
  /** "+ Add to this topic" on a topic header. */
  addHref: (topicId: string) => string
  /** Questions dropped on a topic heading (Topic grouping). */
  onDropMove: (refs: readonly QuestionRef[], to: MoveDestination) => void
}

/**
 * Every tracked question in the shared list grid: one row per question, grouped by
 * topic, journey stage or target page (or flat), with the latest check in the picked
 * market. Sort and search are controlled, so both live in the screen's URL. In Topic
 * grouping a question's text can be dragged onto a topic heading (DropZone).
 */
export function QuestionsGrid({
  list,
  rows,
  sources,
  view,
  search,
  onSearch,
  onSort,
  busy,
  topics,
  bands,
  actions,
  inline,
  empty,
  engines = NO_ENGINES,
  engine = 'all',
  statuses = NO_STATUSES,
  filters,
  filterControls,
  toolbar,
  summary,
  engineSlot
}: {
  list: QuestionsList
  /** Rows after the chip filters. */
  rows: readonly QuestionRow[]
  sources: ReadonlyMap<string, QuestionSource>
  view: QuestionsView
  search: string
  onSearch: (text: string) => void
  onSort: (sort: readonly GridSortKey[]) => void
  busy: boolean
  topics: readonly TopicChoice[]
  /** Each topic's questions band by topic id. */
  bands: ReadonlyMap<string, TopicBand>
  actions: QuestionRowActions
  /** The row whose wording is being edited in place, by prompt id. */
  inline: string | null
  empty: ReactNode
  /** The engines the project checks; two or more add a dot per engine on each row. */
  engines?: readonly EngineId[]
  /** All, or one engine: another engine than Google shows its status as the result. */
  engine?: EngineFilter
  /** Each question's statuses per engine (`questionKey`). */
  statuses?: StatusMap
  /** The engine filter in the toolbar's engine spot (audit2 #8). */
  engineSlot?: ListEngineFilter
  /** The list's one Filter ▾ button (audit2 #7). */
  filters?: readonly FilterGroup[]
  /** Market ▾: its own dropdown while the toolbar has room, else inside Filter ▾. */
  filterControls?: readonly FilterGroup[]
  /** Group ▾, in the toolbar after Filter ▾. */
  toolbar?: ReactNode
  /** The footer's count line ("30 questions · 118 keywords · 2 groups") while not paged. */
  summary?: (info: ListFooterInfo) => ReactNode
}): JSX.Element {
  const mode = view.group
  const marketLabel =
    list.markets.find((market) => market.id === list.marketId)?.label ?? 'the default market'
  /** A group's name as its header shows it. */
  const groupLabel = (groupRows: readonly QuestionRow[], key: string): string => {
    const first = groupRows[0]
    return (first ? groupOf(first, mode, sources)?.label : undefined) ?? key
  }
  /** The ticked rows, kept from the bulk bar so a drag of a ticked row carries them all. */
  const ticked = useRef<readonly QuestionRow[]>([])
  const clearTicked = useRef<() => void>(() => undefined)
  const draggable = mode === 'topic'
  /** A Kind column when the list mixes questions and keywords and no kind filter is on. */
  const showKind = view.type === null && list.rows.some((row) => row.promptKind === 'keyword')

  const columns = useMemo((): ListColumn<QuestionRow>[] => {
    const question: ListColumn<QuestionRow> = {
      id: 'question',
      label: 'Question',
      width: 'fill',
      // The question keeps 240px (audit2 #5): the narrow drops (stage, target page,
      // kind …) go first, so a question is never cut to a few words.
      minWidth: 240,
      sort: (row) => row.text.toLowerCase(),
      // The wording to paste elsewhere, on hover or focus (audit #9); not while it is edited.
      copy: (row) => (row.promptId === inline ? null : row.text),
      // The field and its hint line need the row to grow while a wording is edited here.
      wrap: inline !== null,
      render: (row) =>
        row.promptId === inline ? (
          <InlineQuestionEdit
            row={row}
            rules={rowRules(row, sources.get(row.sourceId), list.lens.brandNames)}
            busy={busy}
            onSave={(text) => actions.onInlineSave(row, text)}
            onCancel={actions.onInlineCancel}
          />
        ) : draggable ? (
          <span
            className="qs-drag"
            draggable
            onDragStart={(event) => {
              const element = event.currentTarget.closest('.ui-lg-row')
              const inSelection =
                element?.getAttribute('aria-selected') === 'true' &&
                ticked.current.some((item) => item.promptId === row.promptId)
              const refs: QuestionRef[] = inSelection ? refsOf(ticked.current) : refsOf([row])
              startDrag(event, refs)
            }}
          >
            <QuestionText row={row} lens={list.lens} />
          </span>
        ) : (
          <QuestionText row={row} lens={list.lens} />
        )
    }
    const from: ListColumn<QuestionRow> = {
      id: 'source',
      label: 'From',
      width: mode === 'none' ? 200 : 128,
      // One topic only: the column would repeat its name on every row.
      hideWhenSame: true,
      sort: (row) => sourceLabel(sources.get(row.sourceId)).toLowerCase(),
      render: (row) => <SourceCell source={sources.get(row.sourceId)} />
    }
    const stage: ListColumn<QuestionRow> = {
      id: 'stage',
      label: 'Stage',
      width: 96,
      hideWhenSame: true,
      sort: stageSort,
      render: (row) => <StageCell row={row} />
    }
    const target: ListColumn<QuestionRow> = {
      id: 'target',
      label: 'Target page',
      width: 128,
      sort: (row) => row.targetUrl,
      render: (row) => <TargetCell row={row} />
    }
    const answerEngine = isAnswerFilter(engine) ? engine : null
    // One answer engine: its status is the result; Google's change, sources cited
    // instead and sentiment have no counterpart there, so those columns go.
    const result: ListColumn<QuestionRow> =
      answerEngine === null
        ? {
            id: 'result',
            label: 'You',
            // "Your other page" and Google's place "#2" (audit2 #3).
            width: 156,
            sort: resultSort,
            render: (row) => <ResultCell row={row} />
          }
        : {
            id: 'engine-result',
            label: engineShortLabel(answerEngine),
            width: 136,
            sort: (row) => statusRank(rowStatuses(row, statuses)?.[answerEngine]),
            render: (row) =>
              row.inMarket ? (
                <EngineStatus status={rowStatuses(row, statuses)?.[answerEngine]} />
              ) : (
                <span className="faint">Not in this market</span>
              )
          }
    // All engines: a dot per engine after the result, "1 of 2" cited.
    const dots: ListColumn<QuestionRow>[] =
      engine === 'all' && engines.length >= 2
        ? [
            {
              id: 'engines',
              label: 'Engines',
              width: 40 + engines.length * 15 + 8,
              sort: (row) => {
                const found = rowStatuses(row, statuses)
                return engines.filter((item) => found?.[item] === 'cited').length
              },
              render: (row) => (
                <EngineDots engines={engines} statuses={rowStatuses(row, statuses)} />
              )
            }
          ]
        : []
    const tail = (columns: ListColumn<QuestionRow>[]): ListColumn<QuestionRow>[] =>
      answerEngine === null ? columns : []
    // No "Checked" column: it pushed the row menu off narrow windows, and each
    // question's detail shows when it was checked.
    const change: ListColumn<QuestionRow> = {
      id: 'change',
      label: 'Change',
      width: 96,
      sort: changeSort,
      render: (row) => <ChangeCell change={row.change} />
    }
    const kind: ListColumn<QuestionRow>[] = showKind
      ? [
          {
            id: 'kind',
            label: 'Type',
            width: 80,
            hideWhenSame: true,
            sort: (row) => row.promptKind,
            render: (row) => <KindCell row={row} />
          }
        ]
      : []
    // Grouped lists leave out "Cited instead" and Sentiment so Stage and Target page fit
    // at 1134 px; the flat list keeps them. The column a grouping shows is left out.
    if (mode === 'topic')
      return [question, ...kind, stage, target, result, ...dots, ...tail([change])]
    if (mode === 'stage')
      return [question, ...kind, from, target, result, ...dots, ...tail([change])]
    if (mode === 'target')
      return [question, ...kind, from, stage, result, ...dots, ...tail([change])]
    const out: ListColumn<QuestionRow>[] = [question, ...kind, from, result, ...dots]
    if (answerEngine !== null) return out
    out.push({
      id: 'instead',
      label: 'Cited instead',
      width: 176,
      sort: (row) => row.citedInstead[0]?.toLowerCase() ?? null,
      render: (row) => <InsteadCell row={row} />
    })
    if (list.hasSentiment) {
      out.push({
        id: 'sentiment',
        label: 'Sentiment',
        width: 100,
        sort: (row) =>
          row.sentiment === null
            ? null
            : ['positive', 'neutral', 'negative'].indexOf(row.sentiment),
        render: (row) => <SentimentCell tone={row.sentiment} />
      })
    }
    out.push(change)
    return out
  }, [
    mode,
    draggable,
    showKind,
    list.hasSentiment,
    list.lens,
    sources,
    inline,
    busy,
    actions,
    engine,
    engines,
    statuses
  ])

  const gridColumns = useMemo(
    () => [
      ...columns,
      askColumn<QuestionRow>((row) => ({ kind: 'question', id: row.promptId, label: row.text }))
    ],
    [columns]
  )
  const shownIds = new Set(columns.map((column) => column.id))
  const sort = view.sort.filter((item) => shownIds.has(item.key))

  function rowMenu(row: QuestionRow): MenuItem[] {
    const inTopic = sources.get(row.sourceId)?.kind === 'topic'
    return questionMenuItems(
      {
        sourceId: row.sourceId,
        promptId: row.promptId,
        text: row.text,
        enabled: row.enabled,
        inTopic,
        stage: row.stage
      },
      {
        onOpen: () => actions.onOpen(row),
        onEdit: () => actions.onEdit(row),
        onEditInline: () => actions.onEditInline(row),
        onCopyText: () => actions.onCopyText(row),
        onDuplicate: () => actions.onMoveOne(row, 'copy'),
        onMove: () => actions.onMoveOne(row, 'move'),
        onSetStage: (stage) => actions.onStageOne(row, stage),
        onToggle: () => actions.onToggle(row),
        onRecheck: () => actions.onRecheckOne(row),
        canRecheck: row.enabled && row.inMarket,
        onRemove: () => actions.onRemoveOne(row)
      }
    )
  }

  function bulk({ selected, clear }: ListBulkContext<QuestionRow>): JSX.Element {
    ticked.current = selected
    clearTicked.current = clear
    return (
      <>
        <AiSelection
          items={selected.map((row) => ({ kind: 'question', id: row.promptId, label: row.text }))}
        />
        <BulkActions
          selected={selected}
          clear={clear}
          busy={busy}
          topics={topics}
          sources={sources}
          handlers={actions}
        />
      </>
    )
  }

  const order = useMemo(() => groupOrder(mode, list, rows), [mode, list, rows])

  return (
    <DropZone
      enabled={draggable}
      onDrop={(refs, to) => {
        clearTicked.current()
        actions.onDropMove(refs, to)
      }}
    >
      <ListGrid<QuestionRow>
        label="Questions"
        noun={['question', 'questions']}
        rows={rows}
        rowKey={(row) => row.promptId}
        rowLabel={(row) => row.text}
        narrowDrops={NARROW_DROPS}
        columns={gridColumns}
        search={{
          text: (row) =>
            `${row.text} ${sourceLabel(sources.get(row.sourceId))} ${row.citedInstead.join(' ')}`,
          // "Questions and keywords" when there are keywords (audit2 #12): they are searches too.
          placeholder: list.rows.some((row) => row.promptKind === 'keyword')
            ? `Search ${list.rows.length.toLocaleString('en-US')} questions and keywords`
            : `Search ${countText(list.rows.length, 'question')}`
        }}
        searchValue={search}
        onSearchChange={onSearch}
        {...(engineSlot ? { engine: engineSlot } : {})}
        {...(filters ? { filters } : {})}
        {...(filterControls ? { filterControls } : {})}
        {...(toolbar !== undefined ? { toolbar } : {})}
        {...(summary ? { summary } : {})}
        sort={sort}
        onSortChange={onSort}
        group={
          mode === 'none'
            ? undefined
            : {
                key: (row) => groupOf(row, mode, sources) ?? { key: '', label: '' },
                order,
                meta: (groupRows, key) => {
                  const isTopic = mode === 'topic' && sources.get(key)?.kind === 'topic'
                  return (
                    <GroupMeta
                      rows={groupRows}
                      groupKey={key}
                      label={sources.get(key)?.name ?? key}
                      mode={mode}
                      band={isTopic ? bands.get(key) : undefined}
                      addHref={isTopic ? actions.addHref(key) : null}
                      onSort={actions.onSort}
                      drillFor={(part) =>
                        questionsGroupDrill({
                          part,
                          mode,
                          groupKey: key,
                          label: groupLabel(groupRows, key),
                          rows: groupRows,
                          list,
                          sources,
                          marketLabel
                        })
                      }
                    />
                  )
                }
              }
        }
        bulk={bulk}
        rowMenu={rowMenu}
        onActivate={actions.onOpen}
        isRowCurrent={(row) => row.promptId === view.row}
        pageSize={50}
        empty={empty}
      />
    </DropZone>
  )
}
