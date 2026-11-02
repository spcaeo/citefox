import { bucketColumns, funnelChart, positionChart, rankedBars } from '@shared/charts'
import {
  LENS_LABELS,
  opportunityChart,
  positionsChart,
  rankedChart,
  REVIEW_LENSES,
  toneChart,
  type OtherPageRow,
  type ReputationIssueView,
  type ReputationRowView,
  type SegmentItem,
  type TargetPageRow,
  type TonePoint
} from '@shared/report/review'
import { esc } from '../html/escape'
import { domainCopy, pageCopy, textCopy, urlCopy } from '../html/copy'
import { namedColumns } from './sections-changed'
import { table } from '../html/tables'
import {
  chart,
  HALF,
  num,
  pagesHtml,
  panel,
  parts,
  tableCtx,
  tiles,
  type ViewCtx
} from './sections'

/**
 * The downloaded Visibility report's own sections (Docs/REPORT-SPEC.md "Visibility
 * report"): Where you stand with the cover strip, headline, opportunity, engines and
 * since-last-check; Your pages with the target pages; Topics with the universe; and
 * Reputation. Same model and numbers as the app (src/shared/report/review/visibility.ts).
 */

function coverHtml(ctx: ViewCtx): string {
  const facts = ctx.report.visibility.cover
    .map(
      (fact) =>
        `<div class="rv-fact"><dt>${esc(fact.label)}</dt><dd>${fact.num ? num(ctx, fact.num, fact.value) : esc(fact.value)}</dd></div>`
    )
    .join('')
  return `<dl class="rv-facts">${facts}</dl>`
}

function kpis(ctx: ViewCtx): string {
  const { report } = ctx
  const notes = report.visibility.kpiNotes
  return `<div class="kpis">${report.standing.kpis
    .map((kpi, index) => {
      const drill = report.drills[kpi.drill]
      const value =
        drill === undefined || drill.ids.length === 0
          ? `<span class="num">${esc(kpi.now)}</span>`
          : num(ctx, { n: drill.ids.length, drill: kpi.drill }, kpi.now)
      return `<div class="kpi"><p class="kpi-label">${esc(kpi.label)}</p><p class="kpi-value">${value}</p><p class="kpi-sub">${esc(notes[index] ?? '')}</p></div>`
    })
    .join('')}</div>`
}

function sinceHtml(ctx: ViewCtx): string {
  const since = ctx.report.visibility.since
  if (since === null) return ''
  const stat = (value: typeof since.gained, label: string): string =>
    `<div class="kpi"><p class="kpi-value">${num(ctx, value)}</p><p class="kpi-label">${esc(label)}</p></div>`
  return panel(
    `Since the previous check, ${since.fromLabel}`,
    `<div class="kpis rv-tiles">${stat(since.gained, 'Started citing you')}${stat(since.lost, 'Stopped citing you')}${stat(since.newlyNamed, 'Newly named')}${stat(since.noLongerNamed, 'No longer named')}</div>` +
      '<p class="note">The What changed report in CiteFox shows every question that moved.</p>',
    'Questions compared with their own previous check.'
  )
}

export function opportunityHtml(ctx: ViewCtx): string {
  const { opportunity } = ctx.report.visibility
  const legend = opportunity.bars
    .map(
      (bar) => `<li><strong>${esc(bar.label)}</strong> ${num(ctx, bar.value)}: ${esc(bar.sub)}</li>`
    )
    .join('')
  const rest =
    opportunity.rest > 0
      ? `<p class="note">${opportunity.rest} more ${opportunity.rest === 1 ? 'answer cites' : 'answers cite'} the right page without your name, or name you without a link.</p>`
      : ''
  return panel(
    'The opportunity',
    chart(bucketColumns({ ...opportunityChart(ctx.report), width: HALF, titles: true }), ctx) +
      `<ul class="rv-legend">${legend}</ul>${rest}`,
    `Of ${opportunity.answers.n} questions with an AI answer: where to act. Click a bar for its questions.`
  )
}

function enginesHtml(ctx: ViewCtx): string {
  const { engines } = ctx.report.visibility
  if (engines.rows.length === 0) {
    return engines.note === null ? '' : `<p class="note">${esc(engines.note)}</p>`
  }
  return panel(
    'By engine',
    table(tableCtx(ctx), {
      id: `${ctx.view}-engines`,
      title: 'By engine',
      quiet: true,
      rows: engines.rows,
      columns: [
        { header: 'Engine', html: (r) => `<strong>${esc(r.label)}</strong>`, csv: (r) => r.label },
        {
          header: 'Answer shown',
          kind: 'num',
          html: (r) => num(ctx, r.answered),
          csv: (r) => r.answered.n
        },
        { header: 'Cites you', kind: 'num', html: (r) => num(ctx, r.cited), csv: (r) => r.cited.n },
        {
          header: 'Right page',
          kind: 'num',
          html: (r) => num(ctx, r.right),
          csv: (r) => r.right.n
        },
        { header: 'Names you', kind: 'num', html: (r) => num(ctx, r.named), csv: (r) => r.named.n }
      ]
    }),
    'The same questions on each engine. Click a number for its questions.'
  )
}

export function visibilityStandingHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const sentiment = report.visibility.reputation.standingLine
  return (
    coverHtml(ctx) +
    `<p class="rv-vline">${parts(ctx, report.visibility.headline)}</p>` +
    (sentiment === null
      ? ''
      : `<p class="note">${esc(sentiment)} <a href="#sec-reputation">See Reputation</a></p>`) +
    kpis(ctx) +
    sinceHtml(ctx) +
    `<div class="grid-2">${panel(
      'Where visibility falls away',
      chart(
        funnelChart({
          label: 'Where visibility falls away',
          width: HALF,
          titles: true,
          steps: report.standing.funnel.map((step) => ({
            id: step.drill,
            label: step.label,
            value: step.value
          }))
        }),
        ctx
      ),
      'From every question tracked to answers that cite and name you.'
    )}${opportunityHtml(ctx)}</div>` +
    enginesHtml(ctx) +
    `<div class="grid-2">${panel(
      'Where you sit among the sources',
      chart(positionChart({ ...positionsChart(report), width: HALF, titles: true }), ctx)
    )}${panel(
      'Most cited sites',
      chart(rankedBars({ ...rankedChart(report), width: HALF, titles: true }), ctx)
    )}</div>`
  )
}

function targetTable(ctx: ViewCtx): string {
  const t = ctx.report.visibility.targets
  return table(tableCtx(ctx), {
    id: `${ctx.view}-targetpages`,
    title: 'Your target pages',
    rows: t.rows,
    limit: 15,
    sortable: true,
    url: (r) => r.url,
    columns: [
      {
        header: 'Page',
        kind: 'path',
        html: (r: TargetPageRow) => pageCopy(r.url, r.path),
        csv: (r: TargetPageRow) => r.url
      },
      { header: 'Role', html: (r) => esc(r.role), csv: (r) => r.role },
      {
        header: 'Set for',
        kind: 'num',
        html: (r) => num(ctx, r.questions),
        csv: (r) => r.questions.n
      },
      ...t.engines.map((engine, index) => ({
        header: engine.label,
        kind: 'num' as const,
        html: (r: TargetPageRow) => (r.engines[index] ? num(ctx, r.engines[index]) : '—'),
        csv: (r: TargetPageRow) => r.engines[index]?.n ?? null
      })),
      {
        header: 'Total',
        kind: 'num',
        html: (r) => `<strong>${num(ctx, r.total)}</strong>`,
        csv: (r) => r.total.n
      },
      {
        header: 'Not cited',
        html: (r) => (r.notCited ? '<span class="chip s-none">Not cited yet</span>' : ''),
        csv: (r) => (r.notCited ? 'Not cited yet' : '')
      }
    ]
  })
}

function othersTable(ctx: ViewCtx): string {
  const rows = ctx.report.visibility.targets.others
  return table(tableCtx(ctx), {
    id: `${ctx.view}-otherpages`,
    title: 'Other pages of yours being cited',
    rows,
    limit: 10,
    sortable: true,
    url: (r) => r.url,
    empty: 'Every page of yours that answers cite is a target page.',
    columns: [
      {
        header: 'Page',
        kind: 'path',
        html: (r: OtherPageRow) => pageCopy(r.url, r.path),
        csv: (r: OtherPageRow) => r.url
      },
      {
        header: 'Questions',
        kind: 'num',
        html: (r) => num(ctx, r.questions),
        csv: (r) => r.questions.n
      },
      {
        header: 'Cited on',
        kind: 'wide',
        html: (r) =>
          r.items
            .slice(0, 3)
            .map(
              (item) =>
                `${textCopy(item.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${item.id}`)}" data-label="${esc(item.text)}">${esc(item.text)}</button>`)}`
            )
            .join('') +
          (r.items.length > 3 ? `<span class="muted">+${r.items.length - 3} more</span>` : ''),
        csv: (r) => r.items.map((item) => item.text).join(' | ')
      }
    ]
  })
}

export function visibilityPagesHtml(ctx: ViewCtx): string {
  const t = ctx.report.visibility.targets
  const head =
    t.empty !== null
      ? `<p class="note">${esc(t.empty)}</p>`
      : tiles(ctx, t.tiles) +
        panel(
          'Your target pages',
          targetTable(ctx),
          'Each Primary and Also OK page, and the questions each engine cites it on.'
        )
  return (
    head +
    panel(
      'Other pages of yours being cited',
      othersTable(ctx),
      'Pages of yours that answers cite but that are not set as a target page.'
    ) +
    pagesHtml(ctx)
  )
}

function bar(value: number): string {
  const width = Math.max(0, Math.min(100, value))
  return `<span class="rv-sharebar" aria-hidden="true"><i style="width:${width}%"></i></span>`
}

export function visibilityTopicsHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const extra = report.visibility.topics
  const group = `${ctx.view}-lens`
  const buttons = REVIEW_LENSES.map(
    (lens, index) =>
      `<button type="button" class="seg" data-switch="${esc(group)}" data-value="${lens}" aria-pressed="${index === 0}">${esc(LENS_LABELS[lens])}</button>`
  ).join('')
  const panels = REVIEW_LENSES.map((lens, index) => {
    const rows = report.topics.lenses[lens]
    const more = extra.rows[lens]
    const flag = (r: SegmentItem): string => {
      const value = more[r.value]?.flag ?? null
      return value === 'small'
        ? ' <span class="chip s-noaio">Few questions</span>'
        : value === 'within'
          ? ' <span class="chip s-noaio">Within noise</span>'
          : ''
    }
    const universe = extra.universe[lens].length ? tiles(ctx, extra.universe[lens]) : ''
    const body = table(tableCtx(ctx), {
      id: `${ctx.view}-topics-${lens}`,
      title: `Results by ${LENS_LABELS[lens]}`,
      rows,
      limit: 20,
      sortable: true,
      columns: [
        {
          header: LENS_LABELS[lens],
          html: (r) => `<strong>${esc(r.value)}</strong>${flag(r)}`,
          csv: (r) => r.value
        },
        {
          header: 'Questions',
          kind: 'num',
          html: (r) => num(ctx, r.questions),
          csv: (r) => r.questions.n
        },
        {
          header: 'Answer shown',
          kind: 'num',
          html: (r) => (more[r.value] ? num(ctx, more[r.value]!.answered) : '—'),
          csv: (r) => more[r.value]?.answered.n ?? null
        },
        ...(report.fromLabel !== null
          ? [
              {
                header: `Cited ${report.fromLabel}`,
                kind: 'num' as const,
                html: (r: SegmentItem) => (r.before ? num(ctx, r.before) : '—'),
                csv: (r: SegmentItem) => r.before?.n ?? null
              }
            ]
          : []),
        {
          header: `Cited ${report.toLabel}`,
          kind: 'num',
          html: (r) => num(ctx, r.now),
          csv: (r) => r.now.n
        },
        {
          header: 'Brand named',
          kind: 'num',
          html: (r) => (more[r.value] ? num(ctx, more[r.value]!.named) : '—'),
          csv: (r) => more[r.value]?.named.n ?? null
        },
        {
          header: `Share ${report.toLabel}`,
          kind: 'num',
          html: (r) =>
            `${bar(more[r.value]?.bar ?? 0)} ${esc(r.shareNow === null ? '—' : `${Math.round(r.shareNow * 100)}%`)}`,
          csv: (r) => (r.shareNow === null ? null : Math.round(r.shareNow * 100))
        },
        {
          header: 'Answer, not you',
          kind: 'num',
          html: (r) => num(ctx, r.open),
          csv: (r) => r.open.n
        },
        ...(report.fromLabel !== null
          ? [
              {
                header: 'Change',
                kind: 'num' as const,
                html: (r: SegmentItem) =>
                  esc(r.change === null ? '—' : r.change > 0 ? `+${r.change}` : String(r.change)),
                csv: (r: SegmentItem) => r.change
              }
            ]
          : []),
        // What changed: the named share before → now and its change (Named is the column above).
        ...(report.comparing
          ? namedColumns<SegmentItem>(ctx, lens).filter((column) => column.header !== 'Named')
          : [])
      ]
    })
    return `<div data-switch-panel="${esc(group)}" data-value="${lens}"${index === 0 ? '' : ' hidden'}>${universe}${body}</div>`
  }).join('')
  return (
    `<div class="seg-bar" role="group" aria-label="Group questions by">${buttons}</div>${panels}` +
    `<p class="note">The bar is the share of a group's questions that cite you. “Few questions”: under ${extra.minimum}, so best and weakest leave it out. “Within noise”: the change is smaller than answers vary from search to search.</p>`
  )
}

const TONE_WORDS: Readonly<Record<string, string>> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative'
}

function toneBar(point: Pick<TonePoint, 'positive' | 'neutral' | 'negative' | 'total'>): string {
  const share = (n: number): number => (point.total === 0 ? 0 : Math.round((n / point.total) * 100))
  return `<span class="rv-tone" aria-hidden="true"><i class="rv-tone-pos" style="width:${share(point.positive)}%"></i><i class="rv-tone-neu" style="width:${share(point.neutral)}%"></i><i class="rv-tone-neg" style="width:${share(point.negative)}%"></i></span>`
}

function net(value: number | null): string {
  if (value === null) return 'Not enough data'
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

export function reputationHtml(ctx: ViewCtx): string {
  const r = ctx.report.visibility.reputation
  const needs = r.needs === null ? '' : `<p class="note">${esc(r.needs)}</p>`
  if (r.basis === '') return needs
  const total = r.claims.positive + r.claims.neutral + r.claims.negative
  const split =
    r.split.length === 0
      ? ''
      : `<div class="grid-2">${panel(
          'Net sentiment',
          `<p class="rv-net">${esc(net(r.claims.net))}</p><p class="note">${r.claims.positive} positive, ${r.claims.neutral} neutral, ${r.claims.negative} negative ${total === 1 ? 'claim' : 'claims'}.${r.claims.net === null ? ' A score needs 5 or more claims.' : ''}</p>`,
          'Positive minus negative claims about you, out of all claims, from −100 to +100.'
        )}${panel(
          'Sentiment split',
          chart(bucketColumns({ ...toneChart(ctx.report), width: HALF, titles: true }), ctx),
          'Answers that name you, by their tone toward you. Click a bar for its questions.'
        )}</div>`
  const themes =
    r.themes.length === 0
      ? ''
      : panel(
          'What AI says about you',
          `<ul class="rv-themes">${r.themes
            .map(
              (theme) =>
                `<li><p><strong>${esc(theme.theme)}</strong> ${toneBar(theme)} <span class="muted">${theme.total} ${theme.total === 1 ? 'claim' : 'claims'} · net ${esc(net(theme.net))}</span></p>` +
                theme.examples
                  .map(
                    (example) =>
                      `<p class="rv-p"><span class="chip ${example.tone === 'positive' ? 's-target' : example.tone === 'negative' ? 's-none' : 's-noaio'}">${esc(TONE_WORDS[example.tone] ?? example.tone)}</span> ${textCopy(example.claim, `“${esc(example.claim)}”`)}</p>`
                  )
                  .join('') +
                '</li>'
            )
            .join('')}</ul>`,
          'The themes of the claims about you, most talked about first.'
        )
  const brands =
    r.brands.length === 0
      ? ''
      : panel(
          'You next to your competitors',
          table(tableCtx(ctx), {
            id: `${ctx.view}-brands`,
            title: 'You next to your competitors',
            quiet: true,
            rows: r.brands,
            columns: [
              {
                header: 'Brand',
                html: (b) =>
                  `<strong>${esc(b.brand)}</strong>${b.own ? ' <span class="chip">You</span>' : ''}`,
                csv: (b) => b.brand
              },
              {
                header: 'Answers naming it',
                kind: 'num',
                html: (b) => num(ctx, b.answers),
                csv: (b) => b.answers.n
              },
              {
                header: 'Named first',
                kind: 'num',
                html: (b) => esc(b.first),
                csv: (b) => b.first
              },
              {
                header: 'Positive',
                kind: 'num',
                html: (b) => esc(b.positive),
                csv: (b) => b.positive
              },
              {
                header: 'Neutral',
                kind: 'num',
                html: (b) => esc(b.neutral),
                csv: (b) => b.neutral
              },
              {
                header: 'Negative',
                kind: 'num',
                html: (b) => esc(b.negative),
                csv: (b) => b.negative
              },
              { header: 'Net', kind: 'num', html: (b) => esc(net(b.net)), csv: (b) => net(b.net) }
            ]
          }),
          'Brands named in the same read answers: how often, how often first, and the tone of the claims about each.'
        )
  const trend =
    r.trend.length === 0
      ? ''
      : panel(
          'Tone per check',
          table(tableCtx(ctx), {
            id: `${ctx.view}-tone`,
            title: 'Tone per check',
            quiet: true,
            rows: r.trend,
            columns: [
              { header: 'Check', html: (p) => esc(p.label), csv: (p) => p.label },
              { header: 'Tone', kind: 'wide', html: (p) => toneBar(p), csv: () => '' },
              {
                header: 'Positive',
                kind: 'num',
                html: (p) => esc(p.positive),
                csv: (p) => p.positive
              },
              {
                header: 'Neutral',
                kind: 'num',
                html: (p) => esc(p.neutral),
                csv: (p) => p.neutral
              },
              {
                header: 'Negative',
                kind: 'num',
                html: (p) => esc(p.negative),
                csv: (p) => p.negative
              },
              { header: 'Net', kind: 'num', html: (p) => esc(net(p.net)), csv: (p) => net(p.net) }
            ]
          }),
          'Claims about you in each check.'
        )
  const question = (item: ReputationIssueView): string =>
    item.question === null
      ? esc(item.questionText)
      : `${textCopy(item.question.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${item.question.id}`)}" data-label="${esc(item.question.text)}">${esc(item.question.text)}</button>`)}`
  const issues = panel(
    'Wrong claims worth correcting',
    table(tableCtx(ctx), {
      id: `${ctx.view}-claims`,
      title: 'Wrong claims',
      quiet: true,
      rows: r.issues,
      limit: 10,
      empty: 'CiteFox AI found no wrong claim in these answers.',
      columns: [
        { header: 'Question', kind: 'wide', html: question, csv: (i) => i.questionText },
        {
          header: 'Claim',
          kind: 'wide',
          html: (i) =>
            `${textCopy(i.claim, `“${esc(i.claim)}”`)}${i.own ? '' : ` <span class="muted">(${esc(i.brand)})</span>`}`,
          csv: (i) => i.claim
        },
        { header: 'Problem', kind: 'wide', html: (i) => esc(i.why), csv: (i) => i.why },
        {
          header: 'Suggested correction',
          kind: 'wide',
          html: (i) =>
            `${esc(i.correction)}${i.sourceToFix ? `<br>${/^https?:\/\//i.test(i.sourceToFix) ? urlCopy(i.sourceToFix) : domainCopy(i.sourceToFix)}` : ''}`,
          csv: (i) => i.correction
        }
      ]
    }),
    'Claims in the answers that CiteFox AI found wrong, with what to correct.'
  )
  const answers = panel(
    'Answer by answer',
    table(tableCtx(ctx), {
      id: `${ctx.view}-answers`,
      title: 'Answer by answer',
      quiet: true,
      rows: r.rows,
      limit: 5,
      sortable: true,
      empty: 'No read answer names you yet.',
      columns: [
        {
          header: 'Question',
          kind: 'wide',
          html: (row: ReputationRowView) =>
            `${textCopy(row.question.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${row.question.id}`)}" data-label="${esc(row.question.text)}">${esc(row.question.text)}</button>`)}`,
          csv: (row: ReputationRowView) => row.question.text
        },
        {
          header: 'Tone',
          html: (row) => esc(TONE_WORDS[row.tone] ?? row.tone),
          csv: (row) => row.tone
        },
        { header: 'Theme', html: (row) => esc(row.theme ?? '—'), csv: (row) => row.theme ?? '' },
        { header: 'Rank', html: (row) => esc(row.rank), csv: (row) => row.rank },
        {
          header: 'Why',
          kind: 'wide',
          html: (row) => esc(row.reason ?? '—'),
          csv: (row) => row.reason ?? ''
        }
      ]
    }),
    'Every read answer that names you. Show all to open the full list.'
  )
  return `${needs}<p class="lede">${esc(r.basis)}</p>${split}${themes}${brands}${issues}${answers}${trend}`
}
