import { useCallback, useContext, useMemo, useState, type JSX } from 'react'
import type { IntentStage, PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { AiSelection } from '../assistant/context/AiSelection'
import { useAiContext } from '../assistant/context/useAiContext'
import { AskSparkle } from '../assistant/sparkle/AskSparkle'
import { Markdown } from '../components/Markdown'
import { DrillLink } from '../drill'
import { DrillContext } from '../drill/context'
import { planFixHash } from '../progress/model'
import { openQuestionEditor } from '../questionEdit/open'
import { SourceQuestionsBulk } from '../questionEdit/SourceQuestionsBulk'
import { navigateHash, pageHash } from '../shell/routes'
import { useQueryList } from '../utils/queryState'
import {
  Button,
  ListGrid,
  type ListColumn,
  type ListGroup,
  type MenuItem,
  type SegmentOption
} from '../ui'
import { Movement } from './bits'
import {
  citedInstanceNames,
  coverageLabel,
  ownLinkCount,
  positionText,
  stageLabel,
  statusLabel
} from './model'
import { CitedInstances } from './CitedInstances'
import type { ResultsDrills } from './results/drills'
import { RESULTS_SELECTION_KEY } from './results/tabs'
import './promptGrid.css'

/** Left out first, in order, when the list is narrower than its row (each prompt's detail has them). */
const NARROW_DROPS: readonly string[] = ['n', 'stage', 'position']

/** To-do first, then what already works, then what the score leaves out (Topic-Overview.png). */
const PROMPT_GROUP_ORDER: readonly PromptCheckStatus[] = [
  'not_cited',
  'brand_mentioned',
  'other_own_page',
  'page_cited',
  'no_aio',
  'error'
]

const GROUP_HINT: Record<PromptCheckStatus, string> = {
  not_cited: 'Improve this page for these',
  brand_mentioned: 'Named in the answer without a link',
  other_own_page: 'Another of your pages is cited',
  page_cited: 'Keep these fresh',
  no_aio: 'Left out of the score',
  error: 'The search failed after retries'
}

const STAGE_ORDER: readonly IntentStage[] = [
  'problem',
  'solution',
  'trigger',
  'comparison',
  'objection',
  'unset'
]

function plain(row: PromptCheckRow): string {
  return row.label.split('**').join('')
}

/**
 * Every prompt of this check as the v2 list grid: grouped by outcome (to-do
 * first), a stage filter, search over prompts and cited domains, and the
 * row's actions behind `⋯`. A row opens Prompt detail; its position, change
 * and cited domains open their own details.
 */
export function PromptGrid({
  prompts,
  domain,
  sinceLabel,
  checkLabel,
  drills,
  questions,
  onOpen
}: {
  prompts: readonly PromptCheckRow[]
  domain: string
  sinceLabel: string
  checkLabel: string
  /** Results drills. With them the cells open their details. */
  drills?: ResultsDrills
  /** Turns on the question actions (edit, leave out, re-check, stage, remove). */
  questions?: { projectId: string; samples: number }
  onOpen: (promptId: string) => void
}): JSX.Element {
  const [stage, setStage] = useState<string>('all')
  const drillApi = useContext(DrillContext)
  const pageId = drills?.scope.pageId ?? null
  // The ticked rows live on the URL, so the header's Check now can check exactly them.
  const [picked, setPicked] = useQueryList(RESULTS_SELECTION_KEY)
  const selection = useMemo(
    () => picked.filter((id) => prompts.some((row) => row.promptId === id)),
    [picked, prompts]
  )

  const stageOptions = useMemo((): SegmentOption<string>[] => {
    const present = STAGE_ORDER.filter((item) => prompts.some((row) => row.intentStage === item))
    return [
      { value: 'all', label: 'All stages' },
      ...present.map((item) => ({
        value: item,
        label: stageLabel(item),
        count: prompts.filter((row) => row.intentStage === item).length
      }))
    ]
  }, [prompts])
  const shownStage = stageOptions.some((option) => option.value === stage) ? stage : 'all'
  const rows = useMemo(
    () =>
      shownStage === 'all' ? prompts : prompts.filter((row) => row.intentStage === shownStage),
    [prompts, shownStage]
  )

  const columns = useMemo(
    (): ListColumn<PromptCheckRow>[] => [
      {
        id: 'n',
        label: '#',
        width: 40,
        numeric: true,
        align: 'start',
        sort: (row) => row.promptPosition,
        cellClassName: 'm3-pg-n',
        render: (row) => row.promptPosition
      },
      {
        id: 'prompt',
        label: 'Question',
        width: 'fill',
        minWidth: 180,
        sort: (row) => plain(row).toLowerCase(),
        // The row's ✦ ends the prompt cell (shown on row hover or focus) rather than
        // taking a column of its own, so the grid still fits a 1024px window.
        cellClassName: 'm3-pg-prompt',
        render: (row) => (
          <>
            <span className="m3-pg-text" title={row.text.split('**').join('')}>
              <Markdown inline baseLevel={3} className="m3-prompt-md">
                {row.text}
              </Markdown>
            </span>
            <AskSparkle
              target={{
                kind: 'question',
                id: row.promptId,
                label: row.text,
                detail: statusLabel(row.status)
              }}
              size="xs"
            />
          </>
        )
      },
      {
        id: 'stage',
        label: 'Stage',
        width: 96,
        sort: (row) => STAGE_ORDER.indexOf(row.intentStage),
        render: (row) => stageLabel(row.intentStage)
      },
      {
        id: 'position',
        label: 'Position',
        width: 72,
        numeric: true,
        sort: (row) => row.position,
        render: (row) => {
          const target = drills?.prompt(row) ?? null
          if (row.position === null || !target) return positionText(row)
          return (
            <DrillLink
              target={target}
              className="m3-pg-link"
              label={`Position ${positionText(row)}: open question ${row.promptPosition}`}
            >
              {positionText(row)}
            </DrillLink>
          )
        }
      },
      {
        id: 'change',
        label: `Since ${sinceLabel}`,
        width: 112,
        sort: (row) => movementRank(row),
        render: (row) => {
          const content = (
            <Movement
              movement={row.movement}
              previousStatus={row.previousStatus}
              previousPosition={row.previousPosition}
            />
          )
          const target = drills?.prompt(row) ?? null
          if (!target || row.movement === null) return content
          return (
            <DrillLink target={target} className="m3-pg-link">
              {content}
              <span className="sr-only">: open question {row.promptPosition}</span>
            </DrillLink>
          )
        }
      },
      {
        id: 'cited',
        label: 'Cited instead',
        width: 168,
        sort: (row) => citedInstanceNames(row.references, domain)[0] ?? null,
        render: (row) => (
          <CitedInstances
            names={citedInstanceNames(row.references, domain)}
            drills={drills ?? null}
            promptLabel={`question ${row.promptPosition}`}
          />
        )
      }
    ],
    [domain, drills, sinceLabel]
  )

  const group = useMemo(
    (): ListGroup<PromptCheckRow> => ({
      key: (row) => ({ key: row.status, label: statusLabel(row.status) }),
      order: PROMPT_GROUP_ORDER,
      meta: (_rows, key) => GROUP_HINT[key as PromptCheckStatus] ?? null
    }),
    []
  )

  const rowMenu = useCallback(
    (row: PromptCheckRow): MenuItem[] => {
      const items: MenuItem[] = [
        {
          id: 'open',
          label: 'Open question detail',
          icon: 'eye',
          onSelect: () => onOpen(row.promptId)
        }
      ]
      if (questions && pageId) {
        items.push({
          id: 'edit',
          label: 'Edit question…',
          icon: 'pencil',
          onSelect: () => openQuestionEditor({ sourceId: pageId, promptId: row.promptId })
        })
      }
      const linkCount =
        row.status === 'no_aio' || row.status === 'error' ? 0 : ownLinkCount(row.references)
      if (drills && drillApi && linkCount > 0) {
        items.push({
          id: 'links',
          label: `Show ${pluralize(linkCount, `${domain} link`)}`,
          icon: 'external',
          onSelect: () => drillApi.open(drills.links('all', [row], `links:${row.promptId}`))
        })
      }
      if (pageId) {
        items.push({
          id: 'gaps',
          label: 'Open in Content gaps',
          icon: 'layers',
          ...(row.coverage ? { hint: coverageLabel(row.coverage) } : {}),
          onSelect: () => navigateHash(pageHash(pageId, 'gaps', { filter: `row:${row.promptId}` }))
        })
        if (row.action) {
          const action = row.action
          items.push({
            id: 'fix',
            label: 'Plan the recommended fix',
            icon: 'wand',
            onSelect: () =>
              navigateHash(planFixHash(pageId, { description: action, promptIds: [row.promptId] }))
          })
        }
      }
      return items
    },
    [domain, drillApi, drills, onOpen, pageId, questions]
  )

  useAiContext({
    filters: shownStage === 'all' ? {} : { stage: stageLabel(shownStage as IntentStage) }
  })
  const scored = prompts.filter((row) => row.status !== 'no_aio' && row.status !== 'error').length
  return (
    <section className="m3-pg" id="m3-prompts" aria-label="Questions">
      <ListGrid<PromptCheckRow>
        urlKey="res"
        columnsMenu
        label={`Buyer questions from the ${checkLabel} check`}
        noun={['question', 'questions']}
        rows={rows}
        rowKey={(row) => row.promptId}
        rowLabel={(row) => `question ${row.promptPosition}`}
        narrowDrops={NARROW_DROPS}
        columns={columns}
        search={{
          text: (row) =>
            `${plain(row)} ${row.text} ${citedInstanceNames(row.references, domain).join(' ')}`,
          placeholder: `Search ${pluralize(prompts.length, 'question')} or cited domains`
        }}
        filter={{
          label: 'Buyer stage',
          options: stageOptions,
          value: shownStage,
          onChange: setStage,
          resetValue: 'all'
        }}
        group={group}
        rowMenu={rowMenu}
        {...(pageId
          ? {
              selection,
              onSelectionChange: setPicked,
              bulk: ({ selected, clear }) => (
                <>
                  <AiSelection
                    items={selected.map((row) => ({
                      kind: 'question',
                      id: row.promptId,
                      label: row.text
                    }))}
                  />
                  <Button
                    size="sm"
                    icon="wand"
                    onClick={() => {
                      navigateHash(
                        planFixHash(pageId, {
                          description: selected
                            .map((row) => row.action ?? `Win question ${row.promptPosition}`)
                            .join('\n'),
                          promptIds: selected.map((row) => row.promptId)
                        })
                      )
                      clear()
                    }}
                  >
                    Plan as a fix
                  </Button>
                  {questions && drills?.scope.marketId ? (
                    <SourceQuestionsBulk
                      projectId={questions.projectId}
                      sourceId={pageId}
                      topic={false}
                      marketId={drills.scope.marketId}
                      marketLabel={drills.scope.marketLabel}
                      samples={questions.samples}
                      picked={selected.map((row) => ({ promptId: row.promptId, text: row.text }))}
                      clear={clear}
                    />
                  ) : null}
                </>
              )
            }
          : {})}
        onActivate={(row) => onOpen(row.promptId)}
        pageSize="all"
        summary={(info) =>
          `${info.matching.toLocaleString('en-US')} of ${pluralize(prompts.length, 'question')} · ${scored.toLocaleString('en-US')} scored`
        }
        empty={<p className="muted">No questions in this check yet.</p>}
      />
    </section>
  )
}

/** Gains first when sorted descending; no earlier check sorts last. */
function movementRank(row: PromptCheckRow): number | null {
  switch (row.movement) {
    case 'gained':
      return 4
    case 'improved':
      return 3
    case 'unchanged':
      return 2
    case 'declined':
      return 1
    case 'lost':
      return 0
    default:
      return null
  }
}
