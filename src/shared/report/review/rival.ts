import { cleanHost, hostIsCompetitor } from '../../competitor-hosts'
import { engineRowsOf } from './engine-rows'
import { isRivalSite, rivalOrder } from './pitch'
import type { ReadyInput } from './ready'
import type { RivalPage, RivalRow, RivalView } from './ready-types'
import { EMPTY_ANSWER_EXTRAS } from './sources-types'
import type { Num, Tile } from './types'

/**
 * Head-to-head (Docs/REPORT-SPEC.md "Short ready reports"): you against one site. The
 * counts reuse the Competitors tab's site row (cited on, with you, the gap) and Where you
 * stand's cited questions, so they match those tabs. The rival is the request's
 * (`rival=<domain>`), else the top competitor.
 */

export function rivalView(input: ReadyInput): RivalView {
  const { book } = input
  const sites = input.report.competition.sites
  const rivals = sites.filter(isRivalSite).sort(rivalOrder)
  const asked = cleanHost(input.ctx.rival ?? '')
  const options = rivals.map((site) => site.domain)
  const domain = asked !== '' ? asked : (options[0] ?? null)
  if (asked !== '' && !options.includes(asked)) options.unshift(asked)
  if (domain === null) {
    return {
      domain: null,
      options,
      tiles: [],
      rows: [],
      brands: [],
      brandsNote: null,
      pages: [],
      pagesNote: null
    }
  }
  const site = sites.find((row) => !row.own && cleanHost(row.domain) === domain) ?? null
  const idsOf = (num: Num | null | undefined): readonly string[] =>
    num == null ? [] : (book.drills[num.drill]?.ids ?? [])
  const themIds = idsOf(site?.now)
  const them = new Set(themIds)
  const youIds = book.drills['now:cited']?.ids ?? []
  const you = new Set(youIds)
  const q = (id: string, title: string, ids: readonly string[]): Num =>
    book.add(`rival:${domain}:${id}`, { title, kind: 'questions', ids: [...new Set(ids)] })
  const themNum = site?.now ?? q('them', `Answers citing ${domain}`, [])
  const youNum = q('you', 'Answers citing your pages', youIds)
  const both = site?.withYou ?? q('both', `${domain} and you in the same answer`, [])
  const gap = site?.gap ?? q('gap', `Answers citing ${domain} but not you`, [])
  const onlyYou = q(
    'onlyyou',
    `Answers citing you but not ${domain}`,
    youIds.filter((id) => !them.has(id))
  )
  const tile = (label: string, num: Num, tone?: Tile['tone']): Tile => ({
    label,
    value: num.n.toLocaleString('en-US'),
    drill: num.drill,
    ...(tone ? { tone } : {})
  })
  const tiles: Tile[] = [
    tile(`${domain} is cited on`, themNum),
    tile('You are cited on', youNum, 'ok'),
    tile('Both cited', both),
    tile(`Only ${domain}: the gap`, gap, gap.n > 0 ? 'warn' : 'neutral'),
    tile('Only you', onlyYou, onlyYou.n > 0 ? 'ok' : 'neutral')
  ]
  const order = { them: 0, tie: 1, you: 2 } as const
  const rows: RivalRow[] = [...new Set([...themIds, ...youIds])]
    .flatMap((id) => {
      const question = input.report.questionsById[id]
      if (question === undefined) return []
      const theirsCited = them.has(id)
      const yoursCited = you.has(id)
      const theirs = theirsCited ? positionOf(input, id, domain) : null
      const yours = yoursCited ? question.positionNow : null
      const winner: RivalRow['winner'] =
        theirsCited && !yoursCited
          ? 'them'
          : yoursCited && !theirsCited
            ? 'you'
            : theirs !== null && yours !== null && theirs !== yours
              ? theirs < yours
                ? 'them'
                : 'you'
              : 'tie'
      return [{ question, theirs, theirsCited, yours, yoursCited, winner }]
    })
    .sort((a, b) => order[a.winner] - order[b.winner])
  const reputation = input.report.visibility.reputation
  const brands = reputation.brands.filter(
    (brand) => brand.own || hostIsCompetitor(domain, brand.brand)
  )
  const named = brands.some((brand) => !brand.own)
  const pages = pagesOf(input, domain, themIds)
  const answers = input.extras.answers ?? EMPTY_ANSWER_EXTRAS
  return {
    domain,
    options,
    tiles,
    rows,
    brands: named ? brands : [],
    brandsNote: named
      ? null
      : reputation.brands.length === 0
        ? 'Needs answers CiteFox AI has read for how they describe each brand.'
        : `The answers CiteFox AI read do not name ${domain} next to you.`,
    pages,
    pagesNote:
      pages.length > 0
        ? null
        : Object.keys(answers.citations).length === 0
          ? 'Needs stored AI answers to list the pages they cite.'
          : `No page of ${domain} is cited in these answers.`
  }
}

/** The rival's best source position in one question's answers (All engines: its best engine). */
function positionOf(input: ReadyInput, id: string, domain: string): number | null {
  let best: number | null = null
  for (const row of engineRowsOf(input.metrics, id)) {
    for (const key of row.domains) {
      if (cleanHost(key) !== domain) continue
      const position = row.sitePositions?.[key]
      if (typeof position === 'number' && (best === null || position < best)) best = position
    }
  }
  return best
}

function pagesOf(input: ReadyInput, domain: string, themIds: readonly string[]): RivalPage[] {
  const answers = input.extras.answers ?? EMPTY_ANSWER_EXTRAS
  const byUrl = new Map<string, { title: string | null; ids: Set<string> }>()
  for (const id of themIds) {
    for (const row of engineRowsOf(input.metrics, id)) {
      for (const source of answers.citations[row.id] ?? []) {
        const host = cleanHost(source.domain || source.url)
        if (host !== domain && !host.endsWith(`.${domain}`)) continue
        const url = source.url.replace(/#.*$/, '')
        const entry = byUrl.get(url) ?? { title: source.title, ids: new Set<string>() }
        entry.ids.add(id)
        if (entry.title === null) entry.title = source.title
        byUrl.set(url, entry)
      }
    }
  }
  return [...byUrl]
    .map(([url, entry]) => ({
      url,
      title: entry.title,
      questions: input.book.add(`rival:${domain}:page:${url}`, {
        title: `Answers citing ${url}`,
        kind: 'questions',
        ids: [...entry.ids]
      })
    }))
    .sort((a, b) => b.questions.n - a.questions.n || a.url.localeCompare(b.url))
    .slice(0, 25)
}
