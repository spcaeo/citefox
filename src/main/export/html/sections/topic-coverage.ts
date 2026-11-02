import { TOPIC_COVERAGE_COPY } from '@shared/report-copy'
import type {
  TopicCoverageGoal,
  TopicCoverageKeywordRow,
  TopicCoverageStage,
  TopicCoverageTodoGroup,
  TopicCoverageTodoRow,
  TopicCoverageTopic
} from '../../model/types'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc, slugId } from '../escape'
import { longDate, pct } from '../format'
import { card, drill, kpi, kpis, rowButton, sectionShell, subHeading } from '../parts'
import { table, type Column } from '../tables'

const C = TOPIC_COVERAGE_COPY
const COL = C.columns

/** Win odds chip tones (classes the report stylesheet already has). */
const WIN_TONE: Readonly<Record<string, string>> = {
  High: 'tone-positive',
  Medium: 'v-partly',
  Low: 's-none'
}

/** Topic coverage (Docs/TOPICS-SPEC.md section 5). Rendered only for topic subjects. */
export function renderTopicCoverage(ctx: RenderContext): RenderedSection {
  const section = ctx.model.topicCoverage ?? { empty: { ...C.empty }, topics: [] }
  const subs: SubLink[] = []
  const body = section.topics
    .map((topic) => renderTopic(ctx, topic, subs, section.topics.length > 1))
    .join('')
  return sectionShell('topic_coverage', body, subs, section.empty)
}

function renderTopic(
  ctx: RenderContext,
  topic: TopicCoverageTopic,
  subs: SubLink[],
  many: boolean
): string {
  const base = `tc-${slugId(`${topic.topicId}-${topic.marketId}`)}`
  const id = (part: string): string => `${base}-${part}`
  const title = (text: string): string => (many ? `${topic.name} · ${text}` : text)
  subs.push(
    { id: id('summary'), title: title(C.executive) },
    { id: id('goals'), title: title(C.goals) },
    { id: id('stages'), title: title(C.stages) },
    { id: id('todo'), title: title(C.todo) },
    { id: id('keywords'), title: title(C.keywords) }
  )
  const checked =
    topic.checkedAt === null ? '' : ` · checked ${longDate(topic.checkedAt, ctx.timeZone)}`
  const header = many
    ? `<h3 class="sub">${esc(topic.name)}</h3><p class="lede">${esc(`${topic.sourceLine} · ${topic.marketLabel}${checked}`)}</p>`
    : `<p class="lede">${esc(`${topic.sourceLine} · ${topic.marketLabel}${checked}`)}</p>`
  return (
    header +
    summary(topic, id('summary')) +
    goals(topic, id('goals')) +
    stages(ctx, topic, id('stages')) +
    todo(ctx, topic, id('todo')) +
    keywords(ctx, topic, id('keywords'))
  )
}

function summary(topic: TopicCoverageTopic, anchor: string): string {
  const note = topic.executiveSaved ? C.executiveSaved : C.executiveBuilt
  const actions =
    topic.nextActions.length === 0
      ? ''
      : `<p class="chart-title">${esc(C.nextActions)}</p><ol class="actions">${topic.nextActions
          .map(
            (action) =>
              `<li>${esc(action.text)}${action.verify === null ? '' : ` <span class="chip">${esc(action.verify)}</span>`}</li>`
          )
          .join('')}</ol>`
  return subHeading(anchor, C.executive, note) + card(`<p>${esc(topic.executive)}</p>${actions}`)
}

/**
 * One goal bar (Mockups/v2/Topic-Report): a 0–100 track with the target band
 * shaded and the cited rate filled, and tick labels for 0, now, the band's
 * edges and 100. Ticks closer than 6 points to one already shown are left out
 * so the labels never overlap.
 */
function goalBar(goal: TopicCoverageGoal): string {
  const rate = goal.rate === null ? null : Math.max(0, Math.min(100, goal.rate))
  const lo = Math.max(0, Math.min(100, goal.bandLo))
  const hi = Math.max(lo, Math.min(100, goal.bandHi))
  const label = `${goal.label}: ${pct(goal.rate)} cited, goal ${lo}–${hi}%`
  const ticks: { at: number; text: string; now: boolean }[] = [{ at: 0, text: '0', now: false }]
  const add = (at: number, text: string, now = false): void => {
    if (now) {
      for (let index = ticks.length - 1; index >= 0; index -= 1) {
        const tick = ticks[index]
        if (tick !== undefined && Math.abs(tick.at - at) < 6) ticks.splice(index, 1)
      }
      ticks.push({ at, text, now })
      return
    }
    if (ticks.some((tick) => Math.abs(tick.at - at) < 6)) return
    ticks.push({ at, text, now })
  }
  add(lo, String(lo))
  add(hi, String(hi))
  add(100, '100')
  if (rate !== null) add(rate, String(rate), true)
  ticks.sort((a, b) => a.at - b.at)
  const tickHtml = ticks
    .map((tick) => {
      const cls = tick.now ? ' class="goal-now"' : ''
      const style = tick.at >= 100 ? 'right:0' : `left:${tick.at}%`
      return `<span${cls} style="${style}">${esc(tick.text)}</span>`
    })
    .join('')
  return (
    `<div class="goal" role="img" aria-label="${esc(label)}">` +
    `<div class="goal-track">` +
    `<div class="goal-band" style="left:${lo}%;width:${hi - lo}%" title="${esc(`Goal ${lo}–${hi}%`)}"></div>` +
    (rate !== null && rate > 0
      ? `<div class="goal-fill" style="width:${rate}%" title="${esc(`${rate}% cited`)}"></div>`
      : '') +
    `</div><div class="goal-ticks num">${tickHtml}</div></div>`
  )
}

/** The KPI row for the topic's lead kind (questions, else keywords). */
function kpiRow(topic: TopicCoverageTopic): string {
  const lead = topic.goals.find((goal) => goal.prompts > 0) ?? topic.goals[0]
  if (lead === undefined) return ''
  const noun = lead.kind === 'question' ? 'questions' : 'keywords'
  const reach = lead.toReachBand > 0 ? `+${lead.toReachBand}` : '0'
  return kpis([
    kpi({
      label: C.kpiRate,
      value: `<span class="num">${esc(pct(lead.rate))}</span>`,
      sub: `goal ${lead.bandLo}–${lead.bandHi}%`,
      tone: 'accent'
    }),
    kpi({
      label: C.kpiAio,
      value: `${drill(lead.withAio, `${lead.label}: AI Overview shown`)}<span class="kpi-unit">/ ${esc(lead.prompts)}</span>`,
      sub: `${lead.noAio.n} with none`
    }),
    kpi({
      label: C.kpiReach,
      value: `<span class="num">${esc(reach)}</span>`,
      sub: lead.toReachBand > 0 ? `more cited ${noun}` : C.bandState[lead.bandState ?? 'in']
    })
  ])
}

function goals(topic: TopicCoverageTopic, anchor: string): string {
  const cards = topic.goals.map((goal) => {
    const state = goal.bandState === null ? '' : C.bandState[goal.bandState]
    const reach = goal.toReachBand > 0 ? `${goal.toReachBand} more cited to reach the band` : state
    const failed =
      goal.failed.n > 0 ? ` · ${drill(goal.failed, `${goal.label}: searches failed`)} failed` : ''
    return card(
      `<p class="chart-title">${esc(goal.label)}</p>` +
        `<p class="kpi-value"><span class="num">${esc(pct(goal.rate))}</span></p>` +
        goalBar(goal) +
        `<p class="kpi-sub">${drill(goal.cited, `${goal.label}: cited`)} of ${drill(goal.withAio, `${goal.label}: AI Overview shown`)} · goal ${goal.bandLo}–${goal.bandHi}% · ${esc(reach)}</p>` +
        `<p class="kpi-sub">${drill(goal.rightPage, `${goal.label}: right page`)} right page · ${drill(goal.otherPage, `${goal.label}: another page`)} another page · ${drill(goal.named, `${goal.label}: brand named`)} named · ${drill(goal.noAio, `${goal.label}: no AI Overview`)} without an overview${failed}</p>`
    )
  })
  return (
    subHeading(anchor, C.goals, C.goalsLede) +
    kpiRow(topic) +
    `<div class="grid-2">${cards.join('')}</div>`
  )
}

function stages(ctx: RenderContext, topic: TopicCoverageTopic, anchor: string): string {
  const columns: Column<TopicCoverageStage>[] = [
    { header: COL.stage, html: (row) => esc(row.label), csv: (row) => row.label },
    {
      header: COL.questions,
      kind: 'num',
      html: (row) => esc(row.questions),
      csv: (row) => row.questions
    },
    {
      header: COL.withAio,
      kind: 'num',
      html: (row) => drill(row.aio, `${row.label}: AI Overview shown`),
      csv: (row) => row.aio.n
    },
    {
      header: COL.cited,
      kind: 'num',
      html: (row) => drill(row.cited, `${row.label}: cited`),
      csv: (row) => row.cited.n
    },
    { header: COL.rate, kind: 'num', html: (row) => esc(pct(row.rate)), csv: (row) => row.rate }
  ]
  return (
    subHeading(anchor, C.stages, C.stagesLede) +
    table(ctx, {
      id: `${anchor}-table`,
      title: C.stages,
      quiet: true,
      rows: topic.stages,
      empty: 'No buyer questions in this topic.',
      columns
    })
  )
}

function todo(ctx: RenderContext, topic: TopicCoverageTopic, anchor: string): string {
  const counts: Column<TopicCoverageTodoGroup>[] = [
    { header: COL.state, html: (row) => esc(row.label), csv: (row) => row.label },
    {
      header: COL.prompts,
      kind: 'num',
      html: (row) => drill(row.count, row.label),
      csv: (row) => row.count.n
    },
    { header: '', kind: 'wide', html: (row) => esc(row.hint), csv: (row) => row.hint }
  ]
  const rowColumns: Column<TopicCoverageTodoRow>[] = [
    {
      header: COL.number,
      kind: 'nowrap',
      html: (row) => esc(label(row)),
      csv: (row) => label(row)
    },
    {
      header: COL.question,
      kind: 'wide',
      html: (row) =>
        row.rowId === null ? esc(row.text) : `${esc(row.text)} ${rowButton(row.rowId, row.text)}`,
      csv: (row) => row.text
    },
    { header: COL.stage, html: (row) => esc(row.stage ?? '—'), csv: (row) => row.stage },
    {
      header: COL.target,
      kind: 'path',
      html: (row) => esc(row.targetPath ?? C.noTarget),
      csv: (row) => row.targetUrl ?? C.noTarget
    },
    {
      header: COL.citedInstead,
      html: (row) => esc(row.citedInstead.join(', ') || '—'),
      csv: (row) => row.citedInstead.join(', ')
    },
    {
      header: COL.winOdds,
      kind: 'num',
      html: (row) =>
        row.winOdds === null
          ? '—'
          : `${row.winLevel === null ? '' : `<span class="chip ${WIN_TONE[row.winLevel] ?? 's-none'}">${esc(row.winLevel)}</span> `}<span class="num">${esc(row.winOdds)}</span>`,
      csv: (row) => row.winOdds
    }
  ]
  const groups = topic.todo
    .filter((group) => group.rows.length > 0)
    .map((group) =>
      table(ctx, {
        id: `${anchor}-${group.state.replaceAll('_', '-')}`,
        title: group.label,
        rows: group.rows,
        columns: rowColumns
      })
    )
    .join('')
  return (
    subHeading(anchor, C.todo, C.todoLede) +
    table(ctx, {
      id: `${anchor}-counts`,
      title: C.todo,
      quiet: true,
      rows: topic.todo,
      columns: counts
    }) +
    groups
  )
}

function label(row: TopicCoverageTodoRow): string {
  return `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`
}

function keywords(ctx: RenderContext, topic: TopicCoverageTopic, anchor: string): string {
  const tables: [string, string, readonly TopicCoverageKeywordRow[]][] = [
    ['group', COL.group, topic.keywords.byGroup],
    ['intent', COL.intent, topic.keywords.byIntent],
    ['funnel', COL.funnel, topic.keywords.byFunnel],
    ['type', COL.pageType, topic.keywords.byPageType]
  ]
  const html = tables
    .map(([key, header, rows]) => {
      const columns: Column<TopicCoverageKeywordRow>[] = [
        { header, html: (row) => esc(row.label), csv: (row) => row.label },
        ...(key === 'group'
          ? [
              {
                header: COL.groupKind,
                html: (row: TopicCoverageKeywordRow) => esc(row.groupKind ?? '—'),
                csv: (row: TopicCoverageKeywordRow) => row.groupKind
              }
            ]
          : []),
        numColumn(COL.keywords, (row) => row.keywords, header),
        numColumn(COL.withAio, (row) => row.aio, header),
        numColumn(COL.youCited, (row) => row.cited, header),
        numColumn(COL.named, (row) => row.named, header),
        {
          header: COL.rate,
          kind: 'num',
          html: (row) => esc(pct(row.rate)),
          csv: (row) => row.rate
        }
      ]
      return table(ctx, {
        id: `${anchor}-${key}`,
        title: `${C.keywords} by ${header.toLowerCase()}`,
        rows,
        empty: 'No keywords in this topic.',
        columns
      })
    })
    .join('')
  return subHeading(anchor, C.keywords, C.keywordsLede) + html
}

function numColumn(
  header: string,
  pick: (row: TopicCoverageKeywordRow) => { n: number; drill: string | null },
  scope: string
): Column<TopicCoverageKeywordRow> {
  return {
    header,
    kind: 'num',
    html: (row) => drill(pick(row), `${scope} ${row.label}: ${header}`),
    csv: (row) => pick(row).n
  }
}
