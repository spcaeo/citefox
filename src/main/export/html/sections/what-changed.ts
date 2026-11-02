import { CITATION_CHANGE_LABELS, type CitationChange } from '@shared/report/diff'
import type { Count, WhatChangedRow } from '../../model/types'
import type { RenderContext, RenderedSection } from '../context'
import { esc } from '../escape'
import { marketById, shortDate } from '../format'
import { drill, perspectiveShell, yesNo } from '../parts'
import { table } from '../tables'

export const WHAT_CHANGED_TITLE = 'What changed'

/** The table id the segment chips filter. */
export const WHAT_CHANGED_TABLE = 'what-changed'

const NOT_COMPARED = 'Not compared'
const NOT_COMPARED_HINT = 'No earlier full result, or the search failed in one of the checks.'

const SUMMARY_WORDS: Readonly<Record<string, string>> = {
  gained: 'gained',
  lost: 'lost',
  kept: 'kept',
  never: 'cited in neither check',
  none: 'not compared'
}

/** `gained`, …, or `none` for a prompt that was not compared. */
function segmentOf(change: CitationChange | null): string {
  return change ?? 'none'
}

export function changePill(change: CitationChange | null): string {
  if (change === null) {
    return `<span class="chg chg-none" title="${esc(NOT_COMPARED_HINT)}">${NOT_COMPARED}</span>`
  }
  return `<span class="chg chg-${change}">${esc(CITATION_CHANGE_LABELS[change])}</span>`
}

function position(value: number | null): string {
  return value === null ? '<span class="dash">—</span>' : `#${esc(Math.round(value))}`
}

/** Before vs after: change chips that filter the table, and every prompt's change. */
export function renderWhatChanged(ctx: RenderContext): RenderedSection {
  const section = ctx.model.whatChanged
  const tz = ctx.timeZone
  const since = shortDate(section.previousAt, tz)
  const chips: { value: string; label: string; count: Count }[] = [
    { value: 'gained', label: CITATION_CHANGE_LABELS.gained, count: section.gained },
    { value: 'lost', label: CITATION_CHANGE_LABELS.lost, count: section.lost },
    { value: 'kept', label: CITATION_CHANGE_LABELS.kept, count: section.kept },
    { value: 'never', label: CITATION_CHANGE_LABELS.never, count: section.never },
    { value: 'none', label: NOT_COMPARED, count: section.noEarlier }
  ]
  const segButton = (value: string, label: string, n: number, pressed: boolean): string =>
    `<button type="button" class="seg" data-seg-table="${WHAT_CHANGED_TABLE}" data-seg-value="${esc(value)}" aria-pressed="${pressed ? 'true' : 'false'}">` +
    `${value === '' ? '' : `<span class="seg-dot chg-${esc(value)}" aria-hidden="true"></span>`}${esc(label)} <span class="seg-n">${n}</span></button>`
  const bar =
    `<div class="seg-bar needs-js" role="group" aria-label="Show prompts by change">` +
    segButton('', 'All', section.rows.length, true) +
    chips
      .filter((chip) => chip.value !== 'none' || chip.count.n > 0)
      .map((chip) => segButton(chip.value, chip.label, chip.count.n, false))
      .join('') +
    `</div>`
  const summary =
    `<p class="chg-summary">Since ${esc(since)}: ` +
    chips
      .filter((chip) => chip.value !== 'none' || chip.count.n > 0)
      .map(
        (chip) =>
          `${drill(chip.count, `${chip.label} since ${since}`)} ${esc(SUMMARY_WORDS[chip.value] ?? chip.label)}`
      )
      .join(', ') +
    `.</p>`
  const rows = table<WhatChangedRow>(ctx, {
    id: WHAT_CHANGED_TABLE,
    title: 'Prompts by change',
    quiet: true,
    rows: section.rows,
    limit: 12,
    segment: (row) => segmentOf(row.change),
    columns: [
      {
        header: 'Prompt',
        kind: 'wide',
        html: (row) =>
          `<span class="prompt-text">${esc(row.prompt)}</span>` +
          `<span class="url">${esc(row.pagePath)} · ${esc(marketById(ctx.model, row.marketId))}</span>`,
        csv: (row) => row.prompt
      },
      {
        header: 'Change',
        kind: 'nowrap',
        html: (row) => changePill(row.change),
        csv: (row) => (row.change === null ? NOT_COMPARED : CITATION_CHANGE_LABELS[row.change])
      },
      {
        header: 'Position before',
        kind: 'num',
        html: (row) => position(row.positionBefore),
        csv: (row) => row.positionBefore
      },
      {
        header: 'Position now',
        kind: 'num',
        html: (row) => position(row.positionNow),
        csv: (row) => row.positionNow
      },
      {
        header: 'Cited through',
        html: (row) =>
          row.citedThrough === null
            ? '<span class="dash">—</span>'
            : `<span class="path">${esc(row.citedThrough)}</span>`,
        csv: (row) => row.citedThrough
      },
      {
        header: 'Own page cited',
        kind: 'center',
        html: (row) => yesNo(row.ownPageCited),
        csv: (row) => (row.ownPageCited === null ? null : row.ownPageCited ? 'Yes' : 'No')
      }
    ]
  })
  const lede =
    section.previousAt === null
      ? 'Each prompt’s latest full check against the full check before it.'
      : `Each prompt’s latest full check (${shortDate(section.currentAt, tz)}) against the full check before it (${since}). Position is the place of your page among the overview’s sources.`
  return perspectiveShell(
    'what_changed',
    WHAT_CHANGED_TITLE,
    lede,
    summary + bar + rows,
    [],
    section.empty
  )
}
