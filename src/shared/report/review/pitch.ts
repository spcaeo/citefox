import { plural } from './items'
import type { ReadyInput } from './ready'
import type { PitchView } from './ready-types'
import type { SiteRow } from './compete-types'
import type { Num, Part, Step } from './types'

/**
 * Pitch / audit (Docs/REPORT-SPEC.md "Short ready reports"): four tiles, the five most
 * cited sites and "What we'd fix first", up to five steps built from the data with no
 * AI call. Works from one check. Reuses the Visibility report's opportunity, the
 * Competitors tab's sites and the Sources tab's threads; registers only the drills it
 * adds (the weakest topic's invisible questions).
 */

/** The Where you stand tiles a pitch shows, by label, with the note index they keep. */
const PITCH_KPIS: readonly { label: string; note: number }[] = [
  { label: 'Show an AI answer', note: 1 },
  { label: 'Cite your pages', note: 2 },
  { label: 'Name your brand', note: 3 },
  { label: 'Answer without you', note: 5 }
]

/** Sites a business can beat: not social or video sites, not big tech. */
export function isRivalSite(site: SiteRow): boolean {
  return !site.own && site.kind !== 'video_social' && site.kind !== 'big_tech'
}

/**
 * The order rivals are offered in: saved competitors first, then the site that beats
 * you on the most questions (its gap), then the most cited. The first is the default.
 */
export function rivalOrder(a: SiteRow, b: SiteRow): number {
  return (
    Number(b.kind === 'competitors') - Number(a.kind === 'competitors') ||
    (b.gap?.n ?? 0) - (a.gap?.n ?? 0) ||
    a.rank - b.rank
  )
}

export function pitchView(input: ReadyInput): PitchView {
  const { standing, visibility, competition } = input.report
  const kpis = PITCH_KPIS.flatMap((wanted) => {
    const kpi = standing.kpis.find((item) => item.label === wanted.label)
    return kpi === undefined ? [] : [{ kpi, note: visibility.kpiNotes[wanted.note] ?? '' }]
  })
  return {
    kpis: kpis.map((item) => item.kpi),
    kpiNotes: kpis.map((item) => item.note),
    sites: competition.sites.slice(0, 5),
    plan: planOf(input)
  }
}

function barOf(input: ReadyInput, id: string): Num | null {
  const bar = input.report.visibility.opportunity.bars.find((item) => item.id === id)
  return bar === undefined || bar.value.n === 0 ? null : bar.value
}

function planOf(input: ReadyInput): Step[] {
  const { book, metrics } = input
  const steps: Step[] = []
  const wrong = barOf(input, 'wrongpage')
  if (wrong !== null) {
    steps.push({
      lead: 'Point AI answers to the right page.',
      parts: [
        wrong,
        ` ${plural(wrong.n, 'question cites', 'questions cite')} another page of yours. Link to each question’s Primary page and answer it near the top of that page.`
      ],
      tab: 'questions'
    })
  }
  const invisible = barOf(input, 'invisible')
  if (invisible !== null) {
    const ids = book.drills[invisible.drill]?.ids ?? []
    const byTopic = new Map<string, string[]>()
    for (const id of ids) {
      const topic = metrics.rows[id]?.segments.topic ?? null
      if (topic === null) continue
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), id])
    }
    const top = [...byTopic].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    )[0]
    const parts: Part[] = [
      invisible,
      ` ${plural(invisible.n, 'question gets', 'questions get')} an AI answer that neither cites nor names you. Write a page that answers ${plural(invisible.n, 'it', 'them')}.`
    ]
    if (top !== undefined && byTopic.size > 1) {
      const num = book.add(`pitch:invisible:${top[0]}`, {
        title: `${top[0]}: the answer neither cites nor names you`,
        kind: 'questions',
        ids: top[1]
      })
      parts.push(` Start with ${top[0]} (`, num, ').')
    }
    steps.push({ lead: 'Write the missing pages.', parts, tab: 'questions' })
  }
  const ugc = barOf(input, 'ugc')
  if (ugc !== null) {
    const { reddit, youtube } = input.report.sources
    const open = reddit.threads.filter((row) => row.reply === 'open' && row.gap.n > 0).length
    const videos = youtube.videos.filter((row) => row.gap.n > 0).length
    const extra: string[] = []
    if (open > 0)
      extra.push(`${open} Reddit ${plural(open, 'thread is', 'threads are')} open for a reply`)
    if (videos > 0)
      extra.push(`${videos} YouTube ${plural(videos, 'video is', 'videos are')} cited`)
    steps.push({
      lead: 'Join the threads the AI reads.',
      parts: [
        ugc,
        ` ${plural(ugc.n, 'answer cites', 'answers cite')} Reddit or YouTube and none of your pages.${extra.length > 0 ? ` ${extra.join('; ')}.` : ''} Answer them with a helpful reply.`
      ],
      tab: 'competitors'
    })
  }
  const rivals = input.report.competition.sites
    .filter((site) => isRivalSite(site) && site.gap !== null && site.gap.n > 0)
    .sort((a, b) => (b.gap?.n ?? 0) - (a.gap?.n ?? 0) || a.rank - b.rank)
  for (const site of rivals.slice(0, Math.max(0, 5 - steps.length)).slice(0, 2)) {
    const gap = site.gap as Num
    steps.push({
      lead: `Beat ${site.domain}.`,
      parts: [
        'Cited on ',
        gap,
        ` ${plural(gap.n, 'question', 'questions')} where you are not. Compare their cited page with yours and cover what they cover.`
      ],
      tab: 'competitors'
    })
  }
  return steps.slice(0, 5)
}
