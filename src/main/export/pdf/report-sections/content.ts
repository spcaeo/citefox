import { REPORT_SECTION_COPY } from '@shared/report-copy'
import type { CoverageLevel } from '@shared/domain'
import { STAGE_LABELS } from '../../model/overview'
import {
  count,
  emptyBlock,
  grouped,
  h2,
  h3,
  noun,
  num,
  para,
  section,
  table,
  yesNo,
  type BlockContext
} from '../blocks'
import { plainTile } from './pages'

/** Sections 9, 10 and 11: Answer shape, Content gaps and Prompts. */

export function answerShapeBlocks(context: BlockContext): void {
  const shape = context.model.answerShape
  const copy = REPORT_SECTION_COPY.answer_shape
  section(context, copy.title, copy.description)
  if (shape.empty !== null) {
    emptyBlock(context, shape.empty)
    return
  }
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(
        context,
        'Answers analysed',
        count(shape.analysed),
        null,
        `${grouped(shape.notAnalysed.n)} not yet analysed`
      ),
      plainTile(context, 'Block types seen', grouped(shape.blockTypes), null),
      plainTile(
        context,
        'Repeating shapes',
        grouped(shape.repeatingShapes),
        'Journeys that two or more answers follow.'
      ),
      plainTile(
        context,
        'Most common shape',
        shape.mostCommon?.fingerprint ?? '—',
        null,
        shape.mostCommon === null ? null : noun(shape.mostCommon.prompts.n, 'prompt')
      ),
      plainTile(
        context,
        'Changed shape',
        count(shape.changed),
        'Answers whose shape changed since the previous check.'
      )
    ]
  })

  h2(context, 'Block frequency')
  if (context.pdf.charts) {
    context.blocks.push({
      kind: 'bars',
      rows: shape.frequency.map((item) => ({
        label: context.say(`${item.code} ${item.label}`),
        value: item.answers.n,
        display: noun(item.answers.n, 'answer'),
        tone: 'blue'
      }))
    })
  } else {
    table(context, {
      headers: ['Block', 'Answers', 'Blocks'],
      rows: shape.frequency.map((item) => [
        `${item.code} ${item.label}`,
        count(item.answers),
        grouped(item.blocks)
      ]),
      widths: [5, 1, 1],
      numeric: [1, 2]
    })
  }
  para(context, 'Answers that contain the block at least once.', 'muted')

  h2(context, 'Recurring answer journeys')
  if (shape.journeys.length === 0) {
    para(context, 'No journey repeats yet.', 'body')
  } else {
    table(context, {
      headers: ['Journey', 'What the answer does, in order', 'Prompts'],
      rows: shape.journeys.map((journey) => [
        journey.fingerprint,
        journey.codes.map((code) => shape.labels[code]).join(' → '),
        count(journey.prompts)
      ]),
      widths: [2, 6, 1],
      numeric: [2]
    })
  }

  if (shape.changes.length > 0) {
    h2(context, 'Changed shape since the previous check')
    table(context, {
      headers: ['Prompt', 'Before', 'After'],
      rows: shape.changes.map((change) => [change.prompt, change.before, change.after]),
      widths: [5, 2, 2]
    })
  }

  h2(context, 'Legend')
  table(context, {
    headers: ['Group', 'Blocks'],
    rows: shape.legend.map((group) => [
      group.label,
      group.codes.map((code) => `${code} ${shape.labels[code]}`).join(' · ')
    ]),
    widths: [2, 7]
  })
  if (shape.templateHash !== null) {
    para(
      context,
      `Classified with the answer shape template ${shape.templateHash.slice(0, 8)}.`,
      'muted'
    )
  }
}

const COVERAGE_TEXT: Record<CoverageLevel, string> = {
  strong: 'Strong',
  partial: 'Partial',
  weak: 'Weak',
  none: 'Not covered'
}

export function contentGapsBlocks(context: BlockContext): void {
  const gaps = context.model.contentGaps
  const copy = REPORT_SECTION_COPY.content_gaps
  section(context, copy.title, copy.description)
  if (gaps.empty !== null) {
    emptyBlock(context, gaps.empty)
    return
  }
  const read = gaps.pageRead
  if (read !== null) {
    h2(context, 'Page read')
    table(context, {
      headers: ['Field', 'What the page says'],
      rows: [
        ['URL', read.url],
        [
          'Title',
          `${read.title ?? '—'}\n${grouped(read.titleLength)} characters${read.titleTruncated ? ', so the end is likely cut in search results' : ''}`
        ],
        ['Meta description', read.metaDescription ?? '—'],
        ['H1', read.h1 ?? '—'],
        ['Last modified', context.date(read.lastModified)],
        ['Read on', context.date(read.readAt)]
      ],
      widths: [1.4, 7]
    })
    if (read.mismatches.length > 0) {
      h3(context, 'Mismatches')
      context.blocks.push({ kind: 'list', items: read.mismatches.map((item) => context.say(item)) })
    }
  }

  h2(context, 'Coverage matrix')
  para(context, gaps.summary, 'lead')
  if (gaps.matrix.length > 0) {
    table(context, {
      headers: ['#', 'Prompt', 'Coverage', 'Where covered now', 'Main gap', 'Action'],
      rows: gaps.matrix.map((row) => [
        String(row.number),
        row.prompt,
        COVERAGE_TEXT[row.coverage],
        row.whereCovered.join(', ') || '—',
        row.mainGap,
        row.actionLabel
      ]),
      widths: [0.4, 3.2, 1.1, 2, 2.6, 1.7],
      size: 7.5
    })
  }

  if (gaps.oneByOne.length > 0) {
    h2(context, 'One by one')
    for (const item of gaps.oneByOne) {
      h3(context, `${item.number}. ${item.prompt}`)
      para(context, `What's there now: ${item.now}`, 'body')
      para(context, `What to update: ${item.update}`, 'body')
      para(context, `New FAQ: ${yesNo(item.newFaq)}`, 'body')
      if (item.faq !== null) {
        context.blocks.push({
          kind: 'faq',
          question: context.say(item.faq.question),
          answer: context.say(item.faq.answer),
          words: `${grouped(item.faq.words)} words`
        })
      }
    }
  }

  if (gaps.pageWide.length > 0) {
    h2(context, 'Page-wide fixes')
    context.blocks.push({
      kind: 'list',
      items: gaps.pageWide.map((fix) => context.say(`${fix.summary} ${fix.detail}`))
    })
  }
}

export function promptsBlocks(context: BlockContext): void {
  const { model } = context
  const copy = REPORT_SECTION_COPY.prompts
  section(context, copy.title, copy.description)
  if (model.prompts.empty !== null) {
    emptyBlock(context, model.prompts.empty)
    return
  }
  const project = model.cover.scope === 'project'
  const pagePath = new Map(model.pages.map((page) => [page.id, page.path]))
  const mark = (value: boolean): string => (value ? 'Yes' : '—')
  table(
    context,
    {
      headers: [
        '#',
        project ? 'Prompt and page' : 'Prompt',
        'Stage',
        'Market',
        'AIO',
        'Cited',
        'Page cited',
        'Named',
        'Pos.',
        'Top cited domains',
        'Last checked'
      ],
      rows: model.rows.map((row) => [
        String(row.number),
        project ? `${row.text}\n${pagePath.get(row.pageId) ?? '—'}` : row.text,
        STAGE_LABELS[row.stage],
        context.marketLabel(row.marketId),
        mark(row.aio),
        mark(row.cited),
        mark(row.pageCited),
        mark(row.named),
        num(row.position),
        row.topDomains.join(', ') || '—',
        context.shortDate(row.checkedAt)
      ]),
      widths: [0.5, 3.7, 1.4, 0.95, 0.6, 0.8, 0.75, 0.9, 0.65, 1.9, 1.3],
      numeric: [0, 8],
      size: 7
    },
    context.promptLimit
  )
  para(
    context,
    'AIO: an AI Overview appears. Pos.: mean citation position of your best result.',
    'muted'
  )
}
