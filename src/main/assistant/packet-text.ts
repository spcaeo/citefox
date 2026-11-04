import type { AssistantContextInput, AssistantTurn } from '@shared/ipc'
import { formatMoment } from '@shared/moment'
import { MOVEMENT_WORDS, STAGE_WORDS, STATUS_WORDS } from '../ask/vocabulary'
import { fence } from '../prompts/blocks'
import type { ContextPacket } from './packet'

/**
 * The packet as the template variables an Ask CiteFox prompt reads. Names and
 * question texts come from websites and users, so they are cleaned, capped
 * and (the question) fenced. The same text is what the number check reads.
 */

const MAX_FIELD = 200

export function clean(value: string, max = MAX_FIELD): string {
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ')
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * "Oct 19, 2026, 3:12 PM (2026-10-19)": the moment in the computer's zone and clock
 * (owner rule: an event always shows its time), plus that zone's day in numbers so the
 * number check passes either way of writing it. `timeZone` and `locale` are for tests.
 */
export function dayText(
  iso: string | null,
  options: { timeZone?: string; locale?: string } = {}
): string {
  if (iso === null) return 'unknown date'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const words = formatMoment(iso, { ...options, year: true })
  const numbers = new Intl.DateTimeFormat('en-CA', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
  return `${words} (${numbers})`
}

export function businessText(packet: ContextPacket): string {
  return `Business: ${clean(packet.project.name)} (${clean(packet.project.domain)})`
}

export function screenText(context: AssistantContextInput, scopeLabel: string | null): string {
  const lines = [
    `Screen: ${clean(context.screenLabel)} (${clean(context.screen, 60)})`,
    context.crumbs.length > 0
      ? `Crumbs: ${context.crumbs.map((item) => clean(item)).join(' › ')}`
      : null,
    scopeLabel ? `Data in scope: ${clean(scopeLabel)}` : null,
    ...Object.entries(context.filters).map(
      ([key, value]) => `Filter ${clean(key, 40)}: ${clean(value, 80)}`
    ),
    context.entities.length > 0
      ? `On screen: ${context.entities
          .slice(0, 12)
          .map(
            (item) =>
              `${item.kind} “${clean(item.label, 120)}”${item.detail ? ` (${clean(item.detail, 80)})` : ''}`
          )
          .join('; ')}`
      : null,
    context.selection.length > 0
      ? `Picked: ${context.selection
          .slice(0, 20)
          .map((item) => `${item.kind} “${clean(item.label, 120)}”`)
          .join('; ')}`
      : null,
    ...context.facts.slice(0, 12).map((fact) => `Shows: ${clean(fact)}`)
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

export function aboutText(context: AssistantContextInput): string {
  const about = context.about
  if (!about) return 'Asked about: the whole screen.'
  return `Asked about: ${about.kind} “${clean(about.label, 240)}”${about.detail ? ` (${clean(about.detail, 120)})` : ''}`
}

export function numbersText(packet: ContextPacket): string {
  return packet.numbers
    .map((item) => `${item.ref} · ${item.label} · ${item.value}${item.unit}`)
    .join('\n')
}

export function screenNumbersText(context: AssistantContextInput): string {
  if (context.numbers.length === 0) return 'None.'
  return context.numbers
    .map((item) => `- ${clean(item.label, 80)}: ${clean(item.value, 80)}`)
    .join('\n')
}

export function rowsText(packet: ContextPacket): string {
  if (packet.rows.length === 0) return 'None: no finished check is stored for this scope.'
  const lines = packet.rows.map((row) =>
    [
      `${row.ref}${row.focus ? ' (asked about)' : ''}`,
      `“${clean(row.text, 220)}”`,
      `${row.pageKind === 'topic' ? 'topic' : 'page'} ${clean(row.pageLabel, 80)}`,
      clean(row.marketLabel, 40),
      `stage ${STAGE_WORDS[row.stage].label}`,
      STATUS_WORDS[row.status].label,
      row.position === null ? 'no position' : `position ${row.position}`,
      row.movement === null ? 'no earlier check' : MOVEMENT_WORDS[row.movement].label,
      row.cited.length === 0 ? 'cites no sites' : `cites ${row.cited.join(', ')}`,
      `checked ${dayText(row.checkedAt)}`
    ].join(' · ')
  )
  const more = packet.scopeRows - packet.rows.length
  return more > 0
    ? `${lines.join('\n')}\n(${more} more rows in scope are not listed.)`
    : lines.join('\n')
}

export function rivalsText(packet: ContextPacket): string {
  const cited =
    packet.rivals.length === 0
      ? 'None.'
      : packet.rivals
          .map((item) => `- ${item.domain}: cited in ${item.rows} of the prompt checks`)
          .join('\n')
  const saved =
    packet.competitors.length === 0
      ? ''
      : `\nSaved competitors: ${packet.competitors
          .map((item) =>
            item.domain ? `${clean(item.name, 60)} (${item.domain})` : clean(item.name, 60)
          )
          .join(', ')}`
  return `${cited}${saved}`
}

export function pagesText(packet: ContextPacket): string {
  if (packet.pages.length === 0) return 'None.'
  return packet.pages
    .map(
      (page) =>
        `${page.ref} · ${clean(page.label, 80)}${page.url ? ` · ${clean(page.url, 160)}` : ''}`
    )
    .join('\n')
}

export function historyText(history: readonly AssistantTurn[]): string {
  if (history.length === 0) return 'None: this is the first question.'
  return history
    .map(
      (turn, index) =>
        `${index + 1}. Asked: ${clean(turn.question, 300)}\n   Answered: ${clean(turn.answer, 400)}`
    )
    .join('\n')
}

export function questionText(question: string): string {
  return fence('question', clean(question, 600))
}

/** Every variable the Ask templates read. */
export function packetVariables(
  packet: ContextPacket,
  question: string,
  history: readonly AssistantTurn[],
  today: string
): Record<string, string> {
  return {
    business: businessText(packet),
    screen: screenText(
      packet.context,
      `${packet.scopeLabel} · checked through ${dayText(packet.checkedThrough)}`
    ),
    about: aboutText(packet.context),
    numbers: numbersText(packet),
    screen_numbers: screenNumbersText(packet.context),
    rows: rowsText(packet),
    rivals: rivalsText(packet),
    pages: pagesText(packet),
    history: historyText(history),
    question: questionText(question),
    today
  }
}
