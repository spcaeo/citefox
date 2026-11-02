import { Fragment, useMemo, type JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { DrillButton, DrillLink, DrillNumber } from '../../drill'
import { BarFill, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { Dotted } from '../bits'
import { countNoun, rowsFor, stageLabel, stageSummary, stageViews } from '../model'
import type { ResultsDrills } from './drills'

type StageView = ReturnType<typeof stageViews>[number]

function rankLabel(rank: StageView['rank']): string {
  if (rank === 'best') return 'Best'
  if (rank === 'weakest') return 'Weakest'
  if (rank === 'unranked') return 'Not ranked'
  return ''
}

/** "By buyer stage": bars open the stage's page-cited prompts; every grid cell drills. */
export function StagesSection({
  results,
  drills
}: {
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const stages = useMemo(() => stageViews(results), [results])
  const columns = useMemo<ListColumn<StageView>[]>(
    () => [
      {
        id: 'stage',
        label: 'Stage',
        width: 'fill',
        minWidth: 120,
        render: (stage) => {
          const all = drills.get(`stage:${stage.stage}`)
          return all ? (
            <DrillButton drill={all} untracked>
              {stageLabel(stage.stage)}
            </DrillButton>
          ) : (
            stageLabel(stage.stage)
          )
        }
      },
      {
        id: 'which',
        label: 'Which questions',
        width: 160,
        render: (stage) =>
          rowsFor(results, stage.promptIds).map((row, index) => {
            const target = drills.prompt(row)
            return (
              <Fragment key={row.promptId}>
                {index > 0 ? ', ' : null}
                {target ? (
                  <DrillLink
                    target={target}
                    label={`Open question ${row.promptPosition}: ${row.label.split('**').join('')}`}
                  >
                    {row.promptPosition}
                  </DrillLink>
                ) : (
                  row.promptPosition
                )}
              </Fragment>
            )
          })
      },
      {
        id: 'prompts',
        label: 'Questions',
        width: 88,
        numeric: true,
        render: (stage) => {
          const all = drills.get(`stage:${stage.stage}`)
          return all ? <DrillNumber drill={all} /> : stage.prompts
        }
      },
      {
        id: 'aio',
        label: 'AI Overview shown',
        width: 96,
        numeric: true,
        render: (stage) => {
          const aio = drills.get(`stage:${stage.stage}:aio`)
          return aio ? <DrillNumber drill={aio} /> : stage.aio
        }
      },
      {
        id: 'cited',
        label: 'Page cited',
        width: 96,
        numeric: true,
        render: (stage) => {
          const cited = drills.get(`stage:${stage.stage}:page`)
          return cited ? <DrillNumber drill={cited} /> : stage.pageCited
        }
      },
      {
        id: 'rate',
        label: 'Cited rate',
        width: 96,
        numeric: true,
        render: (stage) => {
          const cited = drills.get(`stage:${stage.stage}:page`)
          if (stage.rate === null) return '—'
          return cited ? (
            <DrillButton
              drill={cited}
              label={`${stage.rate}%: the ${countNoun(cited.rows.length, 'question', 'questions')} citing this page`}
            >
              {stage.rate}%
            </DrillButton>
          ) : (
            `${stage.rate}%`
          )
        }
      },
      {
        id: 'rank',
        label: 'Rank',
        width: 104,
        render: (stage) => rankLabel(stage.rank)
      }
    ],
    [drills, results]
  )
  return (
    <section
      className="m3-section"
      id="m3-stages"
      aria-labelledby="m3-stage-h"
      data-nfr-chart="buyer-stage"
    >
      <SectionHead
        id="m3-stage-h"
        title="By buyer stage"
        description={<Dotted text={stageSummary(stages)} />}
      />
      <div className="card stack-tight">
        <span className="label" id="m3-stage-bars">
          Page cited rate, of AI Overviews shown
        </span>
        <div role="group" aria-labelledby="m3-stage-bars">
          {stages.map((stage) => {
            const cited = drills.get(`stage:${stage.stage}:page`)
            if (!cited) return null
            return (
              <DrillButton
                key={stage.stage}
                drill={cited}
                className="m3-bar-btn"
                label={`${stageLabel(stage.stage)}, ${stage.rate === null ? 'no rate' : `${stage.rate}%`}, page cited in ${cited.rows.length} of ${countNoun(stage.aio, 'AI Overview', 'AI Overviews')}`}
              >
                <span className="m3-bar-top">
                  <span>{stageLabel(stage.stage)}</span>
                  <span className="mono">{stage.rate === null ? '—' : `${stage.rate}%`}</span>
                </span>
                <BarFill share={(stage.rate ?? 0) / 100} tone="cited" />
              </DrillButton>
            )
          })}
        </div>
      </div>
      <ListGrid
        label="Cited rate by buyer stage. Best and weakest need 2 or more questions."
        noun={['stage', 'stages']}
        rows={stages}
        rowKey={(stage) => stage.stage}
        rowLabel={(stage) => stageLabel(stage.stage)}
        columns={columns}
        empty={<p className="muted">No stages in this check.</p>}
      />
      <ul className="sr-only">
        {stages.map((stage) => (
          <li key={stage.stage} data-nfr-chart-row="parts">
            {stageLabel(stage.stage)}: <span data-nfr-segment="">{stage.pageCited}</span> page cited
            and <span data-nfr-segment="">{stage.aio - stage.pageCited}</span> not, of{' '}
            <span data-nfr-total="">{stage.aio}</span> AI Overviews
          </li>
        ))}
      </ul>
      <p className="m3-section-sub">
        Best/weakest only for stages with 2+ questions. Cited rate = questions citing this page ÷
        questions with an AI Overview.
      </p>
    </section>
  )
}
