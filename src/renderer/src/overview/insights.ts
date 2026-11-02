import type { OverviewQuestion } from '@shared/ipc'
import type { CountNoun } from './model'

/**
 * The "What stands out" line of a Summary drawer: one or two short sentences
 * read from the rows it lists, from stored data only (no AI). Null when the rows
 * have nothing worth saying. Pure.
 */

function plural(count: number, noun: CountNoun): string {
  return count === 1 ? noun.one : noun.many
}

/**
 * How many of a list, in words: "3 of these 7", "both", "all 7", "none of these 7",
 * "this one". Null for none of a one-row list (say that in its own words).
 */
export function ofThese(count: number, total: number): string | null {
  const n = (value: number): string => value.toLocaleString('en-US')
  if (total === 1) return count === 1 ? 'this one' : null
  if (count === total) return total === 2 ? 'both' : `all ${n(total)}`
  if (count === 0) return `none of these ${n(total)}`
  return `${n(count)} of these ${n(total)}`
}

/** The site cited instead most often among rows that do not cite you, with its count. */
export function topInstead(
  rows: readonly Pick<OverviewQuestion, 'you' | 'citedInstead'>[]
): { name: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.you === 'cited') continue
    for (const name of new Set(row.citedInstead)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best: { name: string; count: number } | null = null
  for (const [name, count] of counts) {
    if (best === null || count > best.count || (count === best.count && name < best.name)) {
      best = { name, count }
    }
  }
  return best
}

/** "reddit.com is cited instead in 3 of these 7." Null when no other site is cited. */
export function insteadLine(
  rows: readonly Pick<OverviewQuestion, 'you' | 'citedInstead'>[]
): string | null {
  const top = topInstead(rows)
  if (top === null) return null
  return `${top.name} is cited instead in ${ofThese(top.count, rows.length) ?? 'this one'}.`
}

/** "5 cite your target page, 2 another page of yours. Average place #2.3." */
export function citedLine(
  rows: readonly Pick<OverviewQuestion, 'you' | 'ownPage' | 'position'>[]
): string | null {
  const cited = rows.filter((row) => row.you === 'cited')
  if (cited.length === 0) return null
  const other = cited.filter((row) => row.ownPage === 'other').length
  const target = cited.length - other
  const places = cited.flatMap((row) => (row.position === null ? [] : [row.position]))
  const parts: string[] = []
  const all = cited.length === 1 ? 'It' : `All ${cited.length.toLocaleString('en-US')}`
  const verb = cited.length === 1 ? 'cites' : 'cite'
  if (other === 0) parts.push(`${all} ${verb} your target page.`)
  else if (target === 0) parts.push(`${all} ${verb} another page of yours, not the target page.`)
  else
    parts.push(
      `${target} ${target === 1 ? 'cites' : 'cite'} your target page, ${other} another page of yours.`
    )
  if (places.length > 0) {
    const mean = places.reduce((sum, place) => sum + place, 0) / places.length
    parts.push(`Average place #${(Math.round(mean * 10) / 10).toString()}.`)
  }
  return parts.join(' ')
}

/**
 * The line for any list of searches: how many cite you, then who is cited instead in
 * the rest, or for an all-cited list which pages and the average place.
 */
export function questionsInsight(
  rows: readonly Pick<OverviewQuestion, 'you' | 'ownPage' | 'position' | 'citedInstead'>[],
  noun: CountNoun
): string | null {
  if (rows.length === 0) return null
  const cited = rows.filter((row) => row.you === 'cited').length
  if (cited === rows.length) return citedLine(rows)
  const aio = rows.filter((row) => row.you !== 'no_aio' && row.you !== 'error').length
  if (aio === 0) {
    return rows.length === 1
      ? 'This one showed no AI Overview, so there was nothing to cite.'
      : `None of these ${rows.length.toLocaleString('en-US')} showed an AI Overview, so there was nothing to cite.`
  }
  const instead = insteadLine(rows)
  const lead =
    cited === 0
      ? null
      : `You’re cited in ${ofThese(cited, rows.length) ?? ''} ${plural(rows.length, noun)}.`
  const line = [lead, instead].filter((part): part is string => part !== null).join(' ')
  return line === '' ? null : line
}

/** "5 gained, 2 lost: +3 net." plus a note when the tile's change differs from the net. */
export function movedLine(gained: number, lost: number, delta: number | null): string {
  const net = gained - lost
  const netText = net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '±0'
  const head = `${gained.toLocaleString('en-US')} gained, ${lost.toLocaleString('en-US')} lost: ${netText} net.`
  if (delta === null || delta === net) return head
  return `${head} The tile’s change also counts searches added or removed since then.`
}
