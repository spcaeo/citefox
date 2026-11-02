import { useMemo, useState, type JSX } from 'react'
import type { PromptCheckRow } from '@shared/domain'
import { PromptQuestion } from '../components/PromptQuestion'
import { promptQuestionName } from '../components/promptText'
import { Button, ListGrid, UrlText, type ListColumn } from '../ui'
import {
  displayUrl,
  formatChecked,
  aioLabel,
  hasAio,
  namedLabel,
  positionText,
  stageLabel
} from '../m3/model'
import { questionProject } from '../questionEdit/open'
import { promptRowMenu } from '../questionEdit/pageMenu'
import { OverviewDetail } from './OverviewDetail'
import { FIRST_ROWS, promptTarget, safeExternalUrl, targetHref } from './targets'
import type { DrillScope, DrillTarget } from './types'

function citedTone(row: PromptCheckRow): string {
  return row.status === 'page_cited'
    ? 'drill-cited'
    : row.status === 'other_own_page'
      ? 'drill-other-own'
      : 'drill-muted'
}

/**
 * The prompts drawer's list on the kit ListGrid: one row per prompt, each
 * opening Prompt detail in the drawer's market and check, and expanding in
 * place to "Show the AI Overview" (its text and sources). Every row is drawn
 * (the drawer scrolls); the prompt wraps to two lines. Rows carry
 * `data-drill-row` (their place in the list) for the specs.
 */
export function PromptList({
  label,
  rows,
  scope,
  onOpen
}: {
  label: string
  rows: readonly PromptCheckRow[]
  scope: DrillScope
  onOpen: (target: DrillTarget) => void
}): JSX.Element | null {
  const [all, setAll] = useState(false)
  const shown = useMemo(() => (all ? rows : rows.slice(0, FIRST_ROWS)), [all, rows])
  const columns = useMemo<ListColumn<PromptCheckRow>[]>(
    () => [
      {
        id: 'q',
        label: '#',
        width: 28,
        numeric: true,
        align: 'start',
        cellClassName: 'drill-q',
        render: (row) => row.promptPosition
      },
      {
        id: 'prompt',
        label: 'Question',
        width: 'fill',
        minWidth: 140,
        wrap: true,
        render: (row) => {
          const target = promptTarget(scope, row)
          const href = target ? targetHref(target) : null
          const plain = promptQuestionName(row)
          const text = <PromptQuestion text={row.text} label={row.label} />
          return (
            <span
              className="drill-prompt"
              title={`Question ${row.promptPosition}: ${row.text.split('**').join('')}`}
            >
              {href ? (
                <a href={href} aria-label={`Open question ${row.promptPosition}: ${plain}`}>
                  {text}
                </a>
              ) : (
                text
              )}
            </span>
          )
        }
      },
      { id: 'stage', label: 'Stage', width: 84, render: (row) => stageLabel(row.intentStage) },
      {
        id: 'cited',
        label: 'Cited URL',
        width: 100,
        track: 'minmax(100px, 0.7fr)',
        cellClassName: 'mono drill-clip',
        render: (row) => {
          const tone = citedTone(row)
          const cited = safeExternalUrl(row.citedUrl)
          if (cited) {
            return <UrlText url={cited} label={displayUrl(row.citedUrl)} className={tone} />
          }
          if (hasAio(row)) return <span className={tone}>{displayUrl(row.citedUrl)}</span>
          return (
            <span className="drill-none">
              {aioLabel(row) === 'Unknown' ? 'Check failed' : 'No AI Overview'}
            </span>
          )
        }
      },
      { id: 'pos', label: 'Pos.', width: 40, numeric: true, render: positionText }
    ],
    [scope]
  )
  const pageId = scope.pageId
  if (rows.length === 0) return null

  return (
    <div className="drill-scroll">
      <ListGrid<PromptCheckRow>
        label={label}
        noun={['question', 'questions']}
        rows={shown}
        rowKey={(row) => row.promptId}
        rowLabel={(row) => `question ${row.promptPosition}`}
        columns={columns}
        pageSize="all"
        virtualize={false}
        footer="paged"
        empty={null}
        className="drill-lg"
        rowProps={(_row, index) => ({ 'data-drill-row': index })}
        {...(scope.pageId
          ? {
              onActivate: (row: PromptCheckRow) => {
                const target = promptTarget(scope, row)
                if (target) onOpen(target)
              }
            }
          : {})}
        {...(pageId !== null && questionProject() !== null
          ? {
              rowMenu: (row: PromptCheckRow) =>
                promptRowMenu({ sourceId: pageId, promptId: row.promptId }, row.text)
            }
          : {})}
        renderDetail={(row) => {
          const target = promptTarget(scope, row)
          return (
            <OverviewDetail
              summary={row.aioSummary}
              references={row.references}
              openHref={target ? targetHref(target) : null}
              facts={[
                `AI Overview: ${aioLabel(row)}`,
                `Named: ${namedLabel(row)}`,
                `Checked ${formatChecked(row.checkedAt)}`
              ]}
            />
          )
        }}
        hasDetail={hasAio}
        detailLabel={(row) => `the AI Overview for question ${row.promptPosition}`}
      />
      {shown.length < rows.length ? (
        <Button size="sm" className="drill-more" onClick={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </div>
  )
}
