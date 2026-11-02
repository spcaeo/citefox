import type { PageResults, PromptCheckRow } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { citedInstanceNames, formatMonthDay, statusLabel } from '../m3/model'
import type { ChangeGroup, ChangeItem, UnchangedPrompt } from '../visibility/progress'

/**
 * FR-14.1, FR-14.2, section 7.3. What changed between the previous full check
 * and the latest one, from the two `results:get` payloads Progress already
 * loads. Every list is complete; nothing is trimmed. Never claims a cause.
 */
export interface WhatChangedModel {
  heading: string
  intro: string
  groups: readonly ChangeGroup[]
  unchanged: readonly UnchangedPrompt[]
  unchangedNote: string
}

export interface FixInWindow {
  number: number
  goLiveAt: string
}

export function buildWhatChanged(
  previous: PageResults,
  current: PageResults,
  place: string,
  fixes: readonly FixInWindow[] = []
): WhatChangedModel {
  const before = new Map(previous.prompts.map((row) => [row.promptId, row]))
  const domain = hostOf(current.scope.pageUrl)
  const brand = current.scope.brands[0] ?? 'Your brand'
  const gained: ChangeItem[] = []
  const lost: ChangeItem[] = []
  const named: ChangeItem[] = []
  const unnamed: ChangeItem[] = []
  const moved: ChangeItem[] = []
  const unchanged: UnchangedPrompt[] = []
  let compared = 0
  for (const row of current.prompts) {
    const was = before.get(row.promptId)
    if (was === undefined) continue
    compared += 1
    const base = { id: row.promptId, n: row.promptPosition, label: row.label, full: row.text }
    if (row.status === 'page_cited' && was.status !== 'page_cited') {
      gained.push({
        ...base,
        detail: `Page cited at position ${position(row)} · was ${statusLabel(was.status)}`,
        extra: row.citedUrl ?? '',
        extraMono: true
      })
    } else if (was.status === 'page_cited' && row.status !== 'page_cited') {
      lost.push({
        ...base,
        detail: `Was page cited at position ${position(was)} · now ${statusLabel(row.status)}`,
        extra: insteadText(row, domain),
        extraMono: false
      })
    } else if (row.named === true && was.named === false) {
      named.push({
        ...base,
        detail: `${brand} named in the overview${row.status === 'page_cited' ? '' : ', no link'} · was ${statusLabel(was.status)}`,
        extra: citesText(row),
        extraMono: false
      })
    } else if (row.named === false && was.named === true) {
      unnamed.push({
        ...base,
        detail: `${brand} no longer named · now ${statusLabel(row.status)}`,
        extra: citesText(row),
        extraMono: false
      })
    } else if (isMove(was, row)) {
      moved.push({
        ...base,
        detail: `${stateText(was)} → ${stateText(row)}`,
        extra: '',
        extraMono: false
      })
    } else {
      unchanged.push({ ...base, note: sameNote(row) })
    }
  }
  const changed = compared - unchanged.length
  const total = current.scope.promptCount
  const coverage =
    compared === total && total > 0
      ? `all ${pluralize(total, 'question')} checked both times`
      : `${compared} of ${pluralize(total, 'question')} checked both times`
  const content = contentSentence(current, previous, fixes)
  const groups: ChangeGroup[] = [
    group('Gained a citation', 'up', gained),
    group('Lost a citation', 'down', lost),
    group('Newly named in the text', 'named', named),
    group('No longer named', 'flat', unnamed),
    group('Moved', 'flat', moved)
  ]
  const from = formatMonthDay(previous.run?.finishedAt ?? null)
  const to = formatMonthDay(current.run?.finishedAt ?? null)
  return {
    heading: `What changed since the last check (${from} → ${to})`,
    intro: `${place} · ${coverage} · ${pluralize(changed, 'question')} changed, ${unchanged.length} didn’t. ${content} CiteFox shows both side by side and doesn’t claim one caused the other.`,
    groups,
    unchanged: unchanged.sort((a, b) => a.n - b.n),
    unchangedNote:
      unchanged.length === 0
        ? 'Every question checked both times is in one of these lists.'
        : `Not in these lists: ${numberList(unchanged.map((item) => item.n))}.`
  }
}

function group(title: string, tone: ChangeGroup['tone'], items: ChangeItem[]): ChangeGroup {
  const sorted = items.sort((a, b) => a.n - b.n)
  return {
    title,
    tone,
    count: sorted.length,
    aria: `${title}: ${sorted.length === 0 ? 'none' : pluralize(sorted.length, 'question')}`,
    items: sorted
  }
}

function contentSentence(
  current: PageResults,
  previous: PageResults,
  fixes: readonly FixInWindow[]
): string {
  const run = current.run
  const from = previous.run?.finishedAt ?? ''
  const to = run?.finishedAt ?? ''
  const live = fixes
    .filter((fix) => fix.goLiveAt > from && fix.goLiveAt <= to)
    .map((fix) => `Fix ${fix.number}, ${formatMonthDay(fix.goLiveAt)}`)
  const fixText = live.length > 0 ? ` (${live.join('; ')})` : ''
  if (run?.contentChanged) {
    const summary = run.contentChange?.summary
    return `The page content also changed in this period${fixText}${summary ? `: ${summary.replace(/\.$/, '')}` : ''}.`
  }
  return `The page content didn’t change in this period${fixText}.`
}

function isMove(was: PromptCheckRow, row: PromptCheckRow): boolean {
  if (was.status !== row.status) return true
  if (was.position === null || row.position === null) return false
  return Math.round(was.position) !== Math.round(row.position)
}

function sameNote(row: PromptCheckRow): string {
  if (row.status === 'no_aio') return 'No AI Overview either time'
  if (row.status === 'error') return 'Could not be checked either time'
  const at = row.position === null ? '' : ` at position ${position(row)}`
  return `${statusLabel(row.status)}${at} both times`
}

function stateText(row: PromptCheckRow): string {
  return row.position === null
    ? statusLabel(row.status)
    : `${statusLabel(row.status)} · ${position(row)}`
}

function position(row: PromptCheckRow): string {
  return row.position === null ? '—' : String(Math.round(row.position))
}

function insteadText(row: PromptCheckRow, domain: string): string {
  const names = citedInstanceNames(row.references, domain)
  return names.length === 0 ? '' : `Cited instead: ${[...new Set(names)].slice(0, 3).join(', ')}`
}

function citesText(row: PromptCheckRow): string {
  const names = [...new Set(row.references.map((ref) => ref.domain))]
  return names.length === 0 ? '' : `Overview cites ${names.slice(0, 3).join(', ')}`
}

function numberList(numbers: readonly number[]): string {
  if (numbers.length <= 1) return `question ${numbers.join('')}`
  return `questions ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
