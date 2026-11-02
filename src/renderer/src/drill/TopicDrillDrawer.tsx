import { useMemo, useState, type JSX, type MouseEvent } from 'react'
import type { GridSortKey } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { errorText } from '../components/errorText'
import { createGridCsvExport } from '../grid/adapters'
import type { GridCsvExport } from '../grid/types'
import { countNoun } from '../m3/model'
import { useTopicCall } from '../topics/results/hooks/useTopicCall'
import {
  AiMenu,
  Chip,
  Drawer,
  DrawerGrid,
  DrawerSection,
  IconButton,
  ListGrid,
  UiIcon,
  type ListColumn,
  type MenuItem
} from '../ui'
import { drillAiPatch } from './aiContext'
import { topicDrillCsv } from './csv'
import { openTarget } from './targets'
import type { DrillTarget, TopicDrill, TopicDrillRow } from './types'
import './topic-drill.css'

function isCitedRow(row: TopicDrillRow): boolean {
  return row.matchState === 'right_page' || row.matchState === 'other_page'
}

function winChip(odds: number): JSX.Element {
  const tone = odds >= 70 ? 'ok' : odds >= 40 ? 'warn' : 'neutral'
  const label = odds >= 70 ? 'High' : odds >= 40 ? 'Medium' : 'Low'
  return (
    <span className="tdr-odds">
      <Chip tone={tone} size="sm">
        {label}
      </Chip>
      <span className="num">{odds}</span>
    </span>
  )
}

function columnsFor(drill: TopicDrill): ListColumn<TopicDrillRow>[] {
  const q: ListColumn<TopicDrillRow> = {
    id: 'q',
    label: drill.noun[0] === 'keyword' ? 'K' : 'Q',
    width: 56,
    sort: (row) => Number(row.label.slice(1)),
    render: (row) => <span className="tdr-n num">{row.label}</span>
  }
  const text: ListColumn<TopicDrillRow> = {
    id: 'text',
    label: drill.noun[0] === 'keyword' ? 'Keyword' : 'Question',
    width: 'fill',
    minWidth: 150,
    sort: (row) => row.text.toLowerCase(),
    render: (row) => (
      <span className="tdr-text" title={row.text}>
        {row.text}
      </span>
    )
  }
  const stage: ListColumn<TopicDrillRow> = {
    id: 'stage',
    label: 'Stage',
    width: 84,
    sort: (row) => row.stage,
    render: (row) => row.stage || '—'
  }
  const page: ListColumn<TopicDrillRow> = {
    id: 'page',
    label: drill.view === 'cited' ? 'Cited page' : 'Target page',
    width: 148,
    cellClassName: 'mono',
    render: (row) =>
      row.page ? (
        <span
          className={row.matchState === 'other_page' ? 'tdr-page tdr-other' : 'tdr-page'}
          title={row.page}
        >
          {row.page}
        </span>
      ) : (
        <span className="tdr-none">No page yet</span>
      )
  }
  if (drill.view === 'cited') {
    return [
      q,
      text,
      stage,
      page,
      {
        id: 'pos',
        label: 'Pos.',
        width: 64,
        numeric: true,
        sort: (row) => row.position,
        render: (row) => (row.position === null ? '—' : row.position)
      }
    ]
  }
  return [
    q,
    text,
    stage,
    page,
    {
      id: 'instead',
      label: 'Cited instead',
      width: 150,
      render: (row) =>
        row.aio ? (
          <span className="tdr-domains" title={row.citedDomains.join(', ')}>
            {row.citedDomains.slice(0, 2).join(', ') || '—'}
          </span>
        ) : (
          <span className="tdr-none">No AI Overview</span>
        )
    },
    {
      id: 'odds',
      label: 'Win odds',
      width: 112,
      numeric: true,
      sort: (row) => row.winOdds,
      render: (row) =>
        row.winOdds !== null ? (
          winChip(row.winOdds)
        ) : isCitedRow(row) ? (
          <Chip tone="fox" size="sm">
            {row.position === null ? 'Cited' : `Pos. ${row.position}`}
          </Chip>
        ) : (
          '—'
        )
    }
  ]
}

/** The list's search and sort when the URL holds them (`drill.q`, `drill.sort`). */
export interface TopicDrillGridState {
  searchValue: string
  onSearchChange: (value: string) => void
  sort?: readonly GridSortKey[]
  onSortChange: (sort: readonly GridSortKey[]) => void
}

/**
 * The topic drawer (Topic-Drill.png) in the shared Drawer frame: the
 * questions behind a topic number, with tiles that add them up, one line
 * from saved data (Claude can write a fuller one), and a list grid whose rows
 * open Prompt detail. Row menus see the AI Overview, explain a citation (or
 * why there is none) with Claude, or change the target page. Its total is the
 * number clicked (NFR-14).
 */
export function TopicDrillDrawer({
  drill,
  onClose,
  closeOnLeave = true,
  grid,
  exportCsv
}: {
  drill: TopicDrill
  onClose: () => void
  /** False when the drawer is on the URL: the route change closes it (see DrillDrawer). */
  closeOnLeave?: boolean
  grid?: TopicDrillGridState
  /** Tests only. Production writes through `grid:exportCsv`. */
  exportCsv?: GridCsvExport
}): JSX.Element {
  const { scope } = drill
  const [insightOpen, setInsightOpen] = useState(true)
  const [csvNote, setCsvNote] = useState<string | null>(null)
  const writeCsv = useMemo(() => exportCsv ?? createGridCsvExport(), [exportCsv])
  const columns = useMemo(() => columnsFor(drill), [drill])
  const total = drill.rows.length
  useAiContext(
    drillAiPatch({ title: drill.title, scope, total, noun: drill.noun, topicId: drill.topicId })
  )
  const call = useTopicCall({
    projectId: drill.projectId,
    topicId: drill.topicId,
    marketId: scope.marketId,
    runId: scope.runId
  })
  const likeliest = drill.rows
    .filter((item) => item.winOdds !== null)
    .sort((a, b) => (b.winOdds ?? 0) - (a.winOdds ?? 0))[0]

  function explain(item: TopicDrillRow): void {
    const cited = item.matchState === 'right_page'
    call.start({
      kind: cited ? 'explain' : 'whyNotCited',
      title: cited ? `Why ${item.label} is cited` : `Why ${item.label} isn't cited`,
      promptId: item.promptId
    })
  }

  const aiMenu = (
    <AiMenu
      label="AI actions for these questions"
      actions={[
        {
          id: 'summary',
          label: 'Summarise this topic',
          icon: 'sparkle',
          seconds: call.seconds.summary,
          onSelect: () => call.start({ kind: 'summary', title: 'Topic summary' })
        },
        {
          id: 'why',
          label: likeliest ? `Why isn't ${likeliest.label} cited?` : "Why aren't we cited?",
          icon: 'bulb',
          seconds: call.seconds.whyNotCited,
          disabled: !likeliest,
          onSelect: () => {
            if (likeliest) explain(likeliest)
          }
        },
        {
          id: 'fix',
          label: likeliest ? `Draft the fix for ${likeliest.label}` : 'Draft the fix',
          icon: 'wand',
          seconds: call.seconds.draftFix,
          disabled: !likeliest,
          onSelect: () => {
            if (!likeliest) return
            call.start({
              kind: 'draftFix',
              title: `Fix for ${likeliest.label}`,
              promptId: likeliest.promptId
            })
          }
        }
      ]}
    />
  )

  function open(target: DrillTarget): void {
    openTarget(target)
    if (closeOnLeave && target.kind !== 'url') onClose()
  }

  function onBodyClick(event: MouseEvent<HTMLDivElement>): void {
    // An in-app link leaves this screen: close now rather than wait for the route.
    if (closeOnLeave && (event.target as HTMLElement).closest('a[href^="#"]')) onClose()
  }

  function promptTarget(item: TopicDrillRow): DrillTarget {
    return {
      kind: 'prompt',
      pageId: drill.topicId,
      promptId: item.promptId,
      marketId: scope.marketId,
      runId: scope.runId
    }
  }

  function menuFor(item: TopicDrillRow): MenuItem[] {
    const cited = isCitedRow(item)
    return [
      {
        id: 'overview',
        label: item.aio ? 'See the AI Overview' : 'Open the result',
        icon: 'eye',
        onSelect: () => open(promptTarget(item))
      },
      {
        id: 'explain',
        label: cited ? 'Explain this citation' : "Why aren't we cited?",
        icon: 'sparkle',
        tone: 'ai',
        hint: `${cited ? call.seconds.explain : call.seconds.whyNotCited} s`,
        disabled: !item.aio,
        onSelect: () => explain(item)
      },
      {
        id: 'target',
        label: 'Change target page',
        icon: 'target',
        onSelect: () =>
          open({
            kind: 'topic',
            topicId: drill.topicId,
            filter: `target:${item.promptId}`,
            marketId: scope.marketId
          })
      }
    ]
  }

  async function onExport(): Promise<void> {
    setCsvNote(null)
    try {
      const result = await writeCsv(topicDrillCsv(drill, drill.rows))
      if (result.ok) {
        setCsvNote(`Saved ${countNoun(result.rowCount, 'row', 'rows')} to ${result.fileName}.`)
      } else if (result.reason === 'failed') {
        setCsvNote(result.message)
      }
    } catch (cause) {
      setCsvNote(errorText(cause, 'Could not export these rows.'))
    }
  }

  const subtitle = [
    `${drill.noun[1].charAt(0).toUpperCase()}${drill.noun[1].slice(1)} behind this number`,
    scope.marketLabel,
    scope.checkDateLabel
  ]
    .filter((part) => part.length > 0)
    .join(' · ')
  const anyOther = drill.rows.some((item) => item.matchState === 'other_page')
  const listTitle = `${drill.noun[1].charAt(0).toUpperCase()}${drill.noun[1].slice(1)}`

  return (
    <Drawer
      id="drill"
      title={drill.title}
      heading={
        <span data-drill-title="">
          {drill.title} · <span className="num">{total}</span>
        </span>
      }
      subtitle={subtitle}
      className="drill-drawer"
      attributes={{ 'data-drill': drill.id }}
      focusOnOpen="close"
      focusKey={drill.id}
      onClose={onClose}
      footer={{
        summary: (
          <span className="tdr-legend">
            {anyOther ? (
              <>
                <span className="tdr-swatch" aria-hidden="true" />
                Blue: your site is cited, but not the target page
              </>
            ) : (
              'Counts match the number you clicked.'
            )}
            {csvNote ? <span className="tdr-note">{csvNote}</span> : null}
          </span>
        ),
        cancel: 'Close'
      }}
      tools={[
        {
          id: 'csv',
          kind: 'csv',
          label: `Export CSV of ${countNoun(total, drill.noun[0], drill.noun[1])}`,
          disabled: total === 0,
          onClick: () => void onExport()
        }
      ]}
    >
      <div className="tdr" onClick={onBodyClick}>
        <DrawerGrid>
          <DrawerSection span={12} tone="plain">
            {drill.description ? (
              <p className="tdr-desc">{drill.description.split('**').join('')}</p>
            ) : null}
            <dl className="tdr-tiles">
              {drill.tiles.map((tile) => (
                <div key={tile.label} className="tdr-tile">
                  <dt>{tile.label}</dt>
                  <dd className="num">{tile.value}</dd>
                </div>
              ))}
            </dl>
            {drill.insight && insightOpen ? (
              <div className="tdr-insight" role="status">
                <UiIcon name="sparkle" size={16} />
                <p>{drill.insight}</p>
                <IconButton
                  icon="x"
                  size="sm"
                  label="Dismiss summary"
                  onClick={() => setInsightOpen(false)}
                />
              </div>
            ) : null}
            {call.card}
          </DrawerSection>
          <DrawerSection span={12} tone="plain" title={listTitle} count={total}>
            <ListGrid
              label={`${drill.title} list`}
              noun={drill.noun}
              rows={drill.rows}
              rowKey={(item) => item.promptId}
              rowLabel={(item) => item.label}
              columns={columns}
              search={{ text: (item) => `${item.label} ${item.text} ${item.page ?? ''}` }}
              ai={aiMenu}
              rowMenu={menuFor}
              onActivate={(item) => open(promptTarget(item))}
              isRowCurrent={(item) => item.promptId === call.promptId}
              initialSort={
                drill.view === 'cited'
                  ? [{ key: 'pos', dir: 'asc' }]
                  : [{ key: 'odds', dir: 'desc' }]
              }
              {...grid}
              pageSize="all"
              maxBodyHeight={560}
              summary={(info) =>
                info.matching === info.total
                  ? countNoun(info.total, drill.noun[0], drill.noun[1])
                  : `${info.matching} of ${countNoun(info.total, drill.noun[0], drill.noun[1])}`
              }
              empty={<p className="tdr-empty">No {drill.noun[1]} behind this number.</p>}
            />
          </DrawerSection>
        </DrawerGrid>
      </div>
    </Drawer>
  )
}
