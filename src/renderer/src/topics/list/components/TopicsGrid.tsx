import { useEffect, useMemo, type JSX } from 'react'
import type { QuestionSource } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { askColumn } from '../../../assistant/sparkle/askColumn'
import { useDrill, type ItemDrill } from '../../../drill'
import {
  GoalBar,
  ListGrid,
  UrlText,
  useResultWords,
  type ListColumn,
  type ListEngineFilter,
  type MenuItem,
  type ResultWords
} from '../../../ui'
import { BAND_LABEL, BandChip, bandText } from '../../clusters'
import { questionsDrill, targetPagesDrill } from '../drills'
import { resultOfStatus } from '../../views/model'
import { barValue, checkedText, overviewText, type TopicAction, type TopicLine } from '../model'

export type { TopicGridActions } from './topicMenu'
import { topicRowMenu, type TopicGridActions } from './topicMenu'
import { TopicNameCell } from './TopicNameCell'
import { TopicsBulkBar } from './TopicsBulkBar'
import { useGridQueryState } from '../../../utils/queryState'

/**
 * Left out first, in order, when the list is narrower than its row. The folder goes
 * first (the Tree view shows it); a topic's own screen has the rest.
 */
const NARROW_DROPS: readonly string[] = ['folder', 'goal', 'targets', 'overview']

/**
 * One row per topic (Docs/TOPICS-SPEC.md §8.1): its questions, its cited share against
 * its band, how many showed an overview, its target pages and its last check. Every
 * count opens the questions it counts. The last check sits under the name, so the
 * grid fits the narrow window without scrolling sideways. The `⋯` menu holds the
 * topic's actions.
 */
export function TopicsGrid({
  lines,
  sources,
  marketId,
  current,
  addQuestionsHref,
  onOpen,
  onAction,
  editing,
  onEdit,
  actions,
  busy = false,
  folderOf,
  engine
}: {
  lines: readonly TopicLine[]
  sources: ReadonlyMap<string, QuestionSource>
  marketId: string | null
  /** The marked row (came back from it). */
  current: string | null
  addQuestionsHref: (line: TopicLine) => string
  onOpen: (line: TopicLine) => void
  onAction: (action: TopicAction, line: TopicLine) => void
  /** The topic whose name is being renamed in place. */
  editing: string | null
  onEdit: (topicId: string | null) => void
  actions: TopicGridActions
  /** A bulk action is running. */
  busy?: boolean
  /** The folder each topic sits in, as a column (the dashboard's List view). */
  folderOf?: (line: TopicLine) => string
  /** The engine filter, in the toolbar's engine spot (audit #4). */
  engine?: ListEngineFilter
}): JSX.Element {
  // Search and sort ride in the URL (`tl.q`, `tl.sort`): a link keeps them.
  const grid = useGridQueryState('tl')
  const { open, register } = useDrill()
  const words = useResultWords()
  const bands = new Set(lines.map((line) => bandText(line.band)))
  const goalLabel =
    bands.size === 1 ? `Questions goal (target ${[...bands][0] ?? ''})` : 'Questions goal'
  const drills = useMemo(
    () => new Map(lines.map((line) => [line.id, lineDrills(line, sources, marketId, words)])),
    [lines, sources, marketId, words]
  )
  // Grid cells open their drill through `open`, so tell the host what each one opens:
  // a copied drill link then reopens it.
  useEffect(() => {
    for (const set of drills.values()) {
      for (const drill of Object.values(set)) register(drill)
    }
  }, [drills, register])
  const drillsOf = (line: TopicLine): LineDrills =>
    drills.get(line.id) ?? lineDrills(line, sources, marketId, words)

  const columns: readonly ListColumn<TopicLine>[] = [
    {
      id: 'topic',
      label: 'Topic',
      width: 'fill',
      minWidth: 192,
      sort: (line) => line.name.toLowerCase(),
      render: (line) => (
        <TopicNameCell
          name={line.name}
          meta={`${line.origin} · ${lastCheckText(line.checkedAt)}`}
          paused={line.status === 'paused'}
          editing={editing === line.id}
          onEdit={() => onEdit(line.id)}
          onOpen={() => onOpen(line)}
          onSave={(name) => actions.onRename(line, name).then(() => onEdit(null))}
          onCancel={() => onEdit(null)}
        />
      )
    },
    ...(folderOf
      ? [
          {
            id: 'folder',
            label: 'Folder',
            width: 140,
            sort: (line: TopicLine) => folderOf(line).toLowerCase(),
            render: (line: TopicLine) => folderOf(line)
          }
        ]
      : []),
    {
      id: 'questions',
      label: 'Questions',
      width: 84,
      numeric: true,
      sort: (line) => line.stats.questions,
      render: (line) => line.questionRows.length,
      drill: (line) =>
        line.questionRows.length === 0
          ? null
          : {
              label: `Show the ${line.questionRows.length} questions in ${line.name}`,
              nfrId: drillsOf(line).questions.id,
              onOpen: () => open(drillsOf(line).questions)
            }
    },
    {
      // The topic's one headline, as in the sidebar, the topic page and Progress.
      id: 'cited',
      label: 'Target cited',
      width: 112,
      numeric: true,
      sort: (line) => line.totals.targetPct,
      render: (line) => <span className="num">{targetText(line)}</span>,
      drill: (line) => {
        const cited = drillsOf(line).cited
        if (cited.items.length === 0) return null
        return {
          // The name starts with what the cell shows (WCAG 2.5.3), then what it opens.
          label: `${targetText(line)}: show the ${cited.items.length} searches where ${line.name} has its right page cited`,
          onOpen: () => open(cited)
        }
      }
    },
    {
      // The questions goal is a goal, not the headline: named in full.
      id: 'goal',
      label: goalLabel,
      width: 200,
      sort: (line) => line.stats.rate,
      render: (line) => (
        <span className="tl-cited">
          <span className="tl-cited-bar">
            <GoalBar
              size="sm"
              value={barValue(line.stats)}
              band={line.band}
              valueLabel={goalText(line, words)}
            />
          </span>
          <span className="tl-cited-pct num">
            {line.stats.rate === null ? '—' : `${line.stats.rate}%`}
          </span>{' '}
          <BandChip band={line.stats.band} />
        </span>
      ),
      drill: (line) => {
        const goal = drillsOf(line).goal
        if (goal.items.length === 0) return null
        return {
          label: `${goalText(line, words)}: show the ${goal.items.length} cited questions in ${line.name}`,
          onOpen: () => open(goal)
        }
      }
    },
    {
      id: 'overview',
      label: words.answered,
      width: 112,
      sort: (line) => line.stats.withAio,
      render: (line) => <span className="num">{overviewText(line.stats)}</span>,
      drill: (line) => {
        const shown = drillsOf(line).overview
        if (shown.items.length === 0) return null
        return {
          label: `${overviewText(line.stats)}: show the ${shown.items.length} questions ${words.engine ? `${words.engine} answered` : 'where an AI Overview showed'} in ${line.name}`,
          onOpen: () => open(shown)
        }
      }
    },
    {
      id: 'targets',
      label: 'Target pages',
      width: 136,
      render: (line) => {
        const first = line.targets[0]
        if (first === undefined) return <span className="faint">None yet</span>
        return (
          <span className="tl-targets">
            <UrlText url={first.url} label={first.path} className="tl-target-url" />
            {line.targets.length > 1 ? (
              <button
                type="button"
                className="dg-drill tl-more"
                aria-label={`+${line.targets.length - 1}: show the other ${pluralize(line.targets.length - 1, 'target page')} of ${line.name}`}
                data-nfr-drill={`topics:${line.id}:targets`}
                title={line.targets
                  .slice(1)
                  .map((target) => target.path)
                  .join('\n')}
                onClick={() => open(drillsOf(line).targets)}
              >
                +
                <span data-nfr-figure={`topics:${line.id}:targets`}>{line.targets.length - 1}</span>
              </button>
            ) : null}
          </span>
        )
      }
    }
  ]

  const menu = (line: TopicLine): readonly MenuItem[] =>
    topicRowMenu(line, { onOpen, onEdit, onAction, actions, addQuestionsHref })

  return (
    <ListGrid<TopicLine>
      {...grid.listProps}
      label="Topics"
      noun={['topic', 'topics']}
      rows={lines}
      rowKey={(line) => line.id}
      rowLabel={(line) => line.name}
      {...(engine ? { engine } : {})}
      narrowDrops={NARROW_DROPS}
      columns={[
        ...columns,
        askColumn((line) => ({
          kind: 'topic',
          id: line.id,
          label: line.name,
          detail: `${targetText(line)} right page cited · ${lastCheckText(line.checkedAt)}`
        }))
      ]}
      rowMenu={menu}
      bulk={({ selected, clear }) => (
        <TopicsBulkBar
          selected={selected}
          lines={lines}
          busy={busy}
          clear={clear}
          actions={actions}
        />
      )}
      onActivate={(line) => {
        if (editing !== line.id) onOpen(line)
      }}
      isRowCurrent={(line) => line.id === current}
      className="tl-grid"
      empty={<p className="faint">No topics yet.</p>}
    />
  )
}

/** The headline cell: "22%", or "—" before an overview. */
function targetText(line: TopicLine): string {
  return line.totals.targetPct === null ? '—' : `${line.totals.targetPct}%`
}

/** The goal cell in full: "Questions goal: 42% (target 50–70%), Below band". */
function goalText(line: TopicLine, words: ResultWords): string {
  const target = `target ${bandText(line.band)}`
  if (line.stats.rate === null) return `Questions goal: ${words.noneYet.toLowerCase()} (${target})`
  const state = line.stats.band === null ? '' : `, ${BAND_LABEL[line.stats.band]}`
  return `Questions goal: ${line.stats.rate}% (${target})${state}`
}

/** "checked Oct 19", or "not checked yet". */
function lastCheckText(iso: string | null): string {
  return iso === null ? 'not checked yet' : `checked ${checkedText(iso)}`
}

/** What each count of a topic row opens. */
interface LineDrills {
  questions: ItemDrill
  /** The searches whose target page is cited (the headline's numerator). */
  cited: ItemDrill
  /** The questions the own site is cited for (the questions goal's numerator). */
  goal: ItemDrill
  overview: ItemDrill
  targets: ItemDrill
}

function lineDrills(
  line: TopicLine,
  sources: ReadonlyMap<string, QuestionSource>,
  marketId: string | null,
  words: ResultWords
): LineDrills {
  const cited = line.questionRows.filter((row) => row.overview === true && row.cited)
  const target = line.rows.filter((row) => resultOfStatus(row.status) === 'target')
  return {
    questions: questionsDrill({
      id: `topics:${line.id}:questions`,
      title: `Questions in ${line.name}`,
      description: 'Every buyer question in this topic, with its latest check.',
      rows: line.questionRows,
      sources,
      marketId,
      words
    }),
    cited: {
      ...questionsDrill({
        id: `topics:${line.id}:target`,
        title: `Target page cited in ${line.name}`,
        description: `The target page is cited for ${target.length} of ${line.totals.withAio} searches ${words.withAnswer}.`,
        rows: target,
        sources,
        marketId,
        words
      }),
      noun: ['search', 'searches']
    },
    goal: questionsDrill({
      id: `topics:${line.id}:cited`,
      title: `Cited questions in ${line.name}`,
      description: `The own site was cited for ${cited.length} of ${line.stats.withAio} questions ${words.withAnswer}.`,
      rows: cited,
      sources,
      marketId,
      words
    }),
    overview: questionsDrill({
      id: `topics:${line.id}:overview`,
      title: words.engine
        ? `Questions ${words.engine} answered in ${line.name}`
        : `AI Overview shows in ${line.name}`,
      description: words.engine
        ? `The questions whose latest ${words.engine} check got an answer.`
        : 'The questions whose latest check showed an AI Overview.',
      rows: line.questionRows.filter((row) => row.overview === true),
      sources,
      marketId,
      words
    }),
    targets: targetPagesDrill(line)
  }
}
