import { domainMovers } from '../../metrics/breakdowns'
import { isCitedRow } from '../../metrics/counts'
import type { DomainRow } from '../../metrics/types'
import type { AgencyInput } from './agency'
import { changedPagesView } from './changed-pages'
import type {
  CoverageView,
  CoverView,
  DriversView,
  MoveList,
  PositionDriver,
  SiteDriver,
  WaitingView,
  WhatChangedView
} from './changed-types'
import { plural } from './items'
import { endRows } from './named'
import { sentimentView } from './sentiment'
import { structureView } from './structure'
import type { Finding, Num, Part, QuestionItem, Step } from './types'

/**
 * The What changed report's own parts (Docs/REPORT-SPEC.md "What changed"): the cover
 * strip, what the comparison covers, the four movement lists, the verdict drivers,
 * changed pages and answer structure, and the one panel shown while there is only one
 * check. Every number registers its drill in the report's book.
 */

export interface ChangedInput extends AgencyInput {
  /** The checks the two ends stand for (ISO), or null. */
  fromAt: string | null
  toAt: string | null
  /** "Next check on Nov 11, then every 14 days." or null. */
  schedule: string | null
}

const EMPTY = { n: 0, ids: [] as string[] }

function questionsWord(n: number): string {
  return plural(n, 'question')
}

/** Only one check, or From and To are the same check: nothing to compare. */
export function isWaiting(input: Pick<ChangedInput, 'metrics' | 'fromAt' | 'toAt'>): boolean {
  if (input.metrics.checks.length < 2) return true
  return input.fromAt !== null && input.fromAt === input.toAt
}

function waitingView(input: ChangedInput): WaitingView | null {
  if (!isWaiting(input)) return null
  const one = input.metrics.checks.length < 2
  return {
    title: 'What changed needs a second check',
    line: one
      ? `There is only one check so far (${input.toLabel}). This report compares two checks, so it fills in after the next one.`
      : 'From and To are the same check. Pick an earlier check in From to see what changed.',
    next: input.schedule
  }
}

function coverView(input: ChangedInput, inScope: number): CoverView {
  const { metrics, book, toIds, fromLabel, toLabel, ctx } = input
  const c = metrics.comparison
  const at = (label: string | null): string => (label === null ? '' : `, ${label}`)
  const compared =
    c === null
      ? book.add('now:measured', {
          title: 'Questions measured',
          kind: 'questions',
          ids: metrics.now.measured.ids
        })
      : book.add('compared', {
          title: 'Questions checked at both ends',
          kind: 'questions',
          ids: c.compared.ids
        })
  const answersTo = book.add('ans:a', {
    title: `Questions with an AI answer${at(toLabel)}`,
    kind: 'questions',
    ids: (c?.after ?? metrics.now).answered.ids
  })
  const answersFrom =
    c === null
      ? null
      : book.add('ans:b', {
          title: `Questions with an AI answer${at(fromLabel)}`,
          kind: 'questions',
          ids: toIds(c.before.answered.ids)
        })
  return {
    fromLabel,
    toLabel,
    engineLabel: ctx.engineLabel,
    scopeLabel: ctx.scopeLabel ?? 'Whole project',
    compared,
    inScope,
    answersFrom,
    answersTo,
    line:
      c === null
        ? `Every number covers the ${compared.n} ${questionsWord(compared.n)} checked on ${toLabel}.`
        : `Every number covers the ${compared.n} ${questionsWord(compared.n)} checked on both dates.`
  }
}

function coverageView(input: ChangedInput): CoverageView {
  const { metrics, book, fromLabel, toLabel } = input
  const c = metrics.comparison
  const ex = c?.excluded
  const compared = book.add(c === null ? 'now:measured' : 'compared', {
    title: c === null ? 'Questions measured' : 'Questions checked at both ends',
    kind: 'questions',
    ids: c === null ? metrics.now.measured.ids : c.compared.ids
  })
  const newSince = book.add('excl:new', {
    title: `New since ${fromLabel ?? 'the first check'}: not checked then`,
    kind: 'questions',
    ids: ex?.noBefore.ids ?? EMPTY.ids,
    sub: `First checked after ${fromLabel ?? 'the first check'}, so there is nothing to compare.`
  })
  const noLonger = book.add('excl:gone', {
    title: `No longer checked on ${toLabel}`,
    kind: 'questions',
    ids: ex?.noAfter.ids ?? EMPTY.ids,
    sub: `Checked on ${fromLabel ?? 'the first check'}, not on ${toLabel}.`
  })
  const failed = book.add('excl:failed', {
    title: 'The search failed at one end',
    kind: 'questions',
    ids: ex?.failed.ids ?? EMPTY.ids,
    sub: 'A failed search measures nothing, so the question is left out.'
  })
  const inScope = compared.n + newSince.n + noLonger.n + failed.n
  const percent = inScope === 0 ? null : Math.round((compared.n / inScope) * 100)
  return {
    compared,
    inScope,
    percent,
    newSince,
    noLonger,
    failed,
    nothingLeftOut: inScope > 0 && compared.n === inScope,
    footer: `${compared.n} compared of ${inScope} in scope${percent === null ? '' : ` (${percent}%)`}`
  }
}

function listsOf(input: ChangedInput, byId: ReadonlyMap<string, QuestionItem>): MoveList[] {
  const { book, metrics } = input
  const m = metrics.comparison?.movement
  const items = (num: Num): QuestionItem[] =>
    (book.drills[num.drill]?.ids ?? []).flatMap((id) => {
      const item = byId.get(id)
      return item === undefined ? [] : [item]
    })
  const gained = book.add('gained', {
    title: 'Started citing you',
    kind: 'questions',
    ids: m?.gained.ids ?? []
  })
  const lost = book.add('lost', {
    title: 'Stopped citing you',
    kind: 'questions',
    ids: m?.lost.ids ?? []
  })
  const named = book.drills['named:new']
    ? { n: book.drills['named:new'].ids.length, drill: 'named:new' }
    : null
  const gone = book.drills['named:gone']
    ? { n: book.drills['named:gone'].ids.length, drill: 'named:gone' }
    : null
  const out: MoveList[] = [
    { id: 'gained', label: 'Gained a citation', num: gained, tone: 'ok', items: items(gained) },
    { id: 'lost', label: 'Lost a citation', num: lost, tone: 'warn', items: items(lost) }
  ]
  if (named !== null) {
    out.push({ id: 'named', label: 'Newly named', num: named, tone: 'ok', items: items(named) })
  }
  if (gone !== null) {
    out.push({
      id: 'unnamed',
      label: 'No longer named',
      num: gone,
      tone: 'warn',
      items: items(gone)
    })
  }
  return out
}

function siteDriver(input: ChangedInput, row: DomainRow | undefined): SiteDriver | null {
  if (row === undefined || row.cited.before === null) return null
  const { book, toIds, fromLabel, toLabel } = input
  const nowNum = book.add(`dom:${row.domain}:a`, {
    title: `Questions citing ${row.domain}, ${toLabel}`,
    kind: 'questions',
    ids: row.cited.after?.ids ?? row.cited.now.ids
  })
  const beforeNum = book.add(`dom:${row.domain}:b`, {
    title: `Questions citing ${row.domain}, ${fromLabel ?? ''}`,
    kind: 'questions',
    ids: toIds(row.cited.before.ids)
  })
  return {
    domain: row.domain,
    before: beforeNum.n,
    now: nowNum.n,
    change: nowNum.n - beforeNum.n,
    beforeNum,
    nowNum
  }
}

/** Average source position, one decimal, over rows citing you with a position. */
export function averagePosition(rows: readonly { position: number | null }[]): number | null {
  const list = rows.flatMap((row) => (typeof row.position === 'number' ? [row.position] : []))
  if (list.length === 0) return null
  return Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10
}

function positionDriver(input: ChangedInput): PositionDriver | null {
  const { metrics, book, toIds, fromLabel, toLabel } = input
  const c = metrics.comparison
  if (c === null) return null
  const pairs = endRows(metrics)
  const before = averagePosition(
    pairs.flatMap((p) => (p.from && isCitedRow(p.from) ? [p.from] : []))
  )
  const now = averagePosition(pairs.flatMap((p) => (isCitedRow(p.to) ? [p.to] : [])))
  if (before === null && now === null) return null
  return {
    before,
    now,
    beforeNum: book.add('cite:b', {
      title: `Questions citing your pages, ${fromLabel ?? ''}`,
      kind: 'questions',
      ids: toIds(c.before.cited.ids)
    }),
    nowNum: book.add('cite:a', {
      title: `Questions citing your pages, ${toLabel}`,
      kind: 'questions',
      ids: c.after.cited.ids
    })
  }
}

function driversView(input: ChangedInput): DriversView {
  const movers = domainMovers(input.metrics.domains.filter((row) => !row.own))
  return {
    gainer: siteDriver(input, movers.gained[0]),
    loser: siteDriver(input, movers.lost[0]),
    position: positionDriver(input),
    winBack: input.book.add('lost', {
      title: 'Stopped citing you',
      kind: 'questions',
      ids: input.metrics.comparison?.movement.lost.ids ?? []
    })
  }
}

const pos = (value: number | null): string => (value === null ? 'not cited' : `#${value}`)

/** The drivers as Verdict findings: biggest gaining site, biggest losing site, position. */
export function driverFindings(drivers: DriversView): Finding[] {
  const out: Finding[] = []
  if (drivers.gainer !== null) {
    const g = drivers.gainer
    out.push({
      tone: 'warn',
      lead: `${g.domain} gained the most.`,
      parts: ['It is cited on ', g.beforeNum, ' → ', g.nowNum, ` questions (+${g.change}).`]
    })
  }
  if (drivers.loser !== null) {
    const l = drivers.loser
    out.push({
      tone: 'ok',
      lead: `${l.domain} lost the most.`,
      parts: [
        'It is cited on ',
        l.beforeNum,
        ' → ',
        l.nowNum,
        ` questions (−${Math.abs(l.change)}). The space it left is yours to win.`
      ]
    })
  }
  const p = drivers.position
  if (p !== null && p.before !== null && p.now !== null) {
    const better = p.now < p.before
    const worse = p.now > p.before
    out.push({
      tone: better ? 'ok' : worse ? 'warn' : 'neutral',
      lead: better
        ? 'You sit higher among the sources.'
        : worse
          ? 'You sit lower among the sources.'
          : 'Same place among the sources.',
      parts: [
        `Your average source position went ${pos(p.before)} → ${pos(p.now)}, over `,
        p.beforeNum,
        ' → ',
        p.nowNum,
        ' answers citing you.'
      ]
    })
  }
  return out
}

/** "Win back N questions that stopped citing you", or null when none stopped. */
export function winBackStep(drivers: DriversView, fromLabel: string | null): Step | null {
  const n = drivers.winBack.n
  if (n === 0) return null
  const parts: Part[] = [
    drivers.winBack,
    ` ${questionsWord(n)} cited you${fromLabel ? ` on ${fromLabel}` : ''} and don't now. Open them, see who is cited instead, and answer each one plainly on its right page.`
  ]
  return { lead: `Win back ${n} ${questionsWord(n)} that stopped citing you.`, parts }
}

export function whatChangedView(input: ChangedInput): WhatChangedView {
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const coverage = coverageView(input)
  return {
    cover: coverView(input, coverage.inScope),
    coverage,
    lists: listsOf(input, byId),
    drivers: driversView(input),
    pages: changedPagesView(input),
    structure: structureView(input, byId),
    sentiment: sentimentView(input, byId),
    waiting: waitingView(input)
  }
}
