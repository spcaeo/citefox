import type { VerdictTone } from '@shared/report/verdict'
import type { VerdictFindingModel } from '../../model/types'
import type { RenderContext, RenderedSection } from '../context'
import { esc } from '../escape'
import { shortDate } from '../format'
import { card, drill, note, perspectiveShell } from '../parts'

export const VERDICT_TITLE = 'Verdict'

export const TONE_CLASS: Readonly<Record<VerdictTone, string>> = {
  ok: 'vd-ok',
  warn: 'vd-warn',
  bad: 'vd-bad',
  neutral: 'vd-neutral'
}

const RULES_NOTE =
  'The verdict follows fixed rules on these counts, with no AI. One prompt moving is not a trend: a change counts as clear at 2 prompts and at least 10% of the prompts measured in both checks. Every number opens the prompts behind it.'

/** The badge and its findings, right after the cover. */
export function renderVerdict(ctx: RenderContext): RenderedSection {
  const verdict = ctx.model.verdict
  const tz = ctx.timeZone
  const dates =
    verdict.previousAt === null || verdict.compareLabel === null
      ? `Latest full check ${shortDate(verdict.currentAt, tz)}`
      : `${shortDate(verdict.previousAt, tz)} → ${shortDate(verdict.currentAt, tz)}`
  const findings = verdict.findings.map(findingHtml).join('')
  const body = card(
    `<div class="vd-head"><span class="vd-badge ${TONE_CLASS[verdict.tone]}" data-testid="verdict-badge">${esc(verdict.label)}</span>` +
      `<span class="vd-dates">${esc(dates)}</span></div>` +
      `<ul class="vd-findings" data-testid="verdict-findings">${findings}</ul>` +
      note(RULES_NOTE),
    'vd-card'
  )
  const lede =
    verdict.compareLabel === null
      ? 'What the latest full check says. The next check shows what changes.'
      : `What changed since ${verdict.compareLabel}, and what the latest full check says.`
  return perspectiveShell('verdict', VERDICT_TITLE, lede, body)
}

function findingHtml(finding: VerdictFindingModel): string {
  const parts = finding.parts
    .map((part) => (typeof part === 'string' ? esc(part) : drill(part, part.label, 'inline')))
    .join('')
  return (
    `<li class="vd-finding ${TONE_CLASS[finding.tone]}" data-finding="${esc(finding.id)}">` +
    `<span class="vd-lead">${esc(finding.lead)}</span> <span class="vd-text">${parts}</span></li>`
  )
}
