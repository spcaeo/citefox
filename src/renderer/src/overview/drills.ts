import type { EngineAnswerStatus, EngineId } from '@shared/domain'
import type {
  OverviewCitedSite,
  OverviewShareLink,
  QuestionEngineStatuses,
  VisibilityOverview
} from '@shared/ipc'
import { engineLabel } from '../engines/model'
import { opaqueId, type DrillItem, type DrillScope, type ItemDrill } from '../drill'
import { resultBucket, whatToDo, type ResultBucket } from '../ui/resultTones'
import { questionKeysDrill } from './compare'
import { ofThese } from './insights'
import { countNoun, questionResult } from './model'

/**
 * The Overview's link and site drills: the links behind the citation share
 * ("N of M links") and the questions behind each "Who gets cited" bar. Each
 * list is the overview's own data, so the drawer total equals the number
 * clicked. Pure.
 */

function scopeOf(data: VisibilityOverview, marketLabel: string): DrillScope {
  return {
    pageId: null,
    marketId: data.marketId,
    runId: null,
    marketLabel,
    checkDateLabel: 'Latest checks',
    brand: data.brand,
    domain: data.domain
  }
}

function linkItem(link: OverviewShareLink): DrillItem {
  return {
    id: link.id,
    primary: link.url,
    mono: true,
    url: link.url,
    secondary: link.promptText,
    target: {
      kind: 'prompt',
      pageId: link.pageId,
      promptId: link.promptId,
      marketId: link.marketId,
      runId: link.runId
    },
    cells: { site: link.own ? 'Your site' : link.host, position: `#${link.position}` },
    group: link.own ? 'own' : 'other'
  }
}

const LINK_COLUMNS = [
  { id: 'site', label: 'Site', width: 'minmax(120px, 0.6fr)' },
  { id: 'position', label: 'Position', align: 'end' as const, width: '84px' }
]

/** Every link behind the share ("of M links"): your links first, then everyone else's. */
export function shareLinksDrill(data: VisibilityOverview, marketLabel: string): ItemDrill {
  return {
    kind: 'items',
    id: 'kpi:share',
    title: 'Links in AI Overviews',
    description: `Every link the AI Overviews gave in the latest checks, once per question. Citation share is your links ÷ all of them (${data.domain} first).`,
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: LINK_COLUMNS,
    items: data.shareLinks.map(linkItem),
    summary: [
      { label: 'Your site', group: 'own' },
      { label: 'Other sites', group: 'other' }
    ],
    note: 'Select a link to open its question on that check, or its address to open the page.',
    scope: scopeOf(data, marketLabel)
  }
}

/** Your links behind the share ("N of M links"). */
export function ownLinksShareDrill(data: VisibilityOverview, marketLabel: string): ItemDrill {
  return {
    kind: 'items',
    id: 'kpi:share:own',
    title: `Links to ${data.domain}`,
    description: `Every link the AI Overviews gave to ${data.domain} in the latest checks, once per question.`,
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: LINK_COLUMNS,
    items: data.shareLinks.filter((link) => link.own).map(linkItem),
    note: 'Select a link to open its question on that check, or its address to open the page.',
    scope: scopeOf(data, marketLabel)
  }
}

/** A short opaque id for a site, so the drill URL never carries its name or domain. */
export function siteDrillId(site: Pick<OverviewCitedSite, 'name' | 'own'>): string {
  return site.own ? 'site:own' : `site:s${opaqueId(site.name.toLowerCase())}`
}

/** The questions whose latest overview cites one "Who gets cited" site. */
export function citedSiteDrill(data: VisibilityOverview, site: OverviewCitedSite): ItemDrill {
  const keys = new Set(site.keys)
  const rows = data.questions.filter((item) => keys.has(item.key))
  const cited = rows.filter((item) => item.you === 'cited').length
  return questionKeysDrill(data, {
    ...(site.own || rows.length === 0
      ? {}
      : {
          insight:
            cited === 0
              ? `You’re not cited in ${rows.length === 1 ? 'this one' : 'any of these'}: ${site.name} is cited instead.`
              : `You’re cited in ${ofThese(cited, rows.length) ?? 'this one'} too.`
        }),
    id: siteDrillId(site),
    title: site.own
      ? `${countNoun(data).Many} where you’re cited`
      : `${countNoun(data).Many} citing ${site.name}`,
    description: `${countNoun(data).Many} whose latest AI Overview links to ${site.own ? data.domain : site.name}.`,
    keys: site.keys
  })
}

/** The drill id of a result's searches ("96 not cited"), and of "Needs work". */
export function resultDrillId(result: ResultBucket | 'needs_work'): string {
  return `result:${result}`
}

/** The latest-check questions that ended in `result`, each opening its prompt detail. */
export function resultDrill(data: VisibilityOverview, result: ResultBucket): ItemDrill {
  const info = resultBucket(result)
  return questionKeysDrill(data, {
    id: resultDrillId(result),
    title: `${info.label}: latest checks`,
    description: `${countNoun(data).Many} whose latest check ended as “${info.label}”. What to do: ${whatToDo(result)}`,
    keys: data.questions.filter((item) => questionResult(item) === result).map((item) => item.key)
  })
}

/** Searches that need work: not cited, or cited on another own page than the target. */
export function needsWorkDrill(data: VisibilityOverview): ItemDrill {
  return questionKeysDrill(data, {
    id: resultDrillId('needs_work'),
    title: 'Searches that need work',
    description:
      'Not cited, or cited on another page of your site than the target. Fixes rolls them up into page fixes.',
    keys: data.questions
      .filter((item) => {
        const result = questionResult(item)
        return result === 'not_cited' || result === 'other_page'
      })
      .map((item) => item.key)
  })
}

/** The engine headline numbers that open their questions. */
export type EngineSet =
  | 'checked'
  | 'answered'
  | 'cited'
  | 'named'
  | 'unavailable'
  | 'no_answer'
  | 'gained'
  | 'lost'
  | 'moved'

const ENGINE_SET_TITLE: Readonly<Record<EngineSet, string>> = {
  checked: 'Questions checked',
  answered: 'Questions answered',
  cited: 'Questions where you’re cited',
  named: 'Questions where you’re named',
  unavailable: 'Questions not answered yet',
  no_answer: 'Questions without an answer',
  gained: 'Citations gained',
  lost: 'Citations lost',
  moved: 'Citations that moved'
}

const ENGINE_SET_DESCRIPTION: Partial<Record<EngineSet, string>> = {
  unavailable:
    'The engine could not answer these at the latest check. CiteFox tries them again at the next check.',
  no_answer: 'The engine gave no answer to these at the latest check.',
  gained: 'Cited at the latest check, not at the check before.',
  lost: 'Cited at the check before, not at the latest check.',
  moved: 'Cited now and not at the check before (gained), or the other way round (lost).'
}

function inEngineSet(
  status: EngineAnswerStatus | undefined,
  move: 'gained' | 'lost' | undefined,
  set: EngineSet
): boolean {
  if (status === undefined) return false
  switch (set) {
    case 'checked':
      return true
    case 'answered':
      return status === 'cited' || status === 'named' || status === 'not_cited'
    case 'cited':
      return status === 'cited'
    case 'named':
      return status === 'named'
    case 'unavailable':
      return status === 'unavailable'
    case 'no_answer':
      return status === 'no_answer'
    case 'gained':
    case 'lost':
      return move === set
    case 'moved':
      return move !== undefined
  }
}

/**
 * The questions behind one engine headline number, counted as `scopedCounts`
 * counts them: this Summary's questions, each in its own market.
 */
export function engineDrill(
  data: VisibilityOverview,
  statuses: readonly QuestionEngineStatuses[],
  engine: EngineId,
  set: EngineSet
): ItemDrill {
  const byKey = new Map(
    statuses.map((row) => [`${row.pageId}\u0000${row.marketId}\u0000${row.promptId}`, row])
  )
  const label = engineLabel(engine)
  const rowOf = (item: {
    pageId: string
    marketId: string
    promptId: string
  }): QuestionEngineStatuses | undefined =>
    byKey.get(`${item.pageId}\u0000${item.marketId}\u0000${item.promptId}`)
  const picked = data.questions.filter((item) => {
    const row = rowOf(item)
    return inEngineSet(row?.statuses[engine], row?.moved?.[engine], set)
  })
  const googleCited = picked.filter((item) => item.you === 'cited').length
  const drill = questionKeysDrill(data, {
    id: `engine:${engine}:${set}`,
    title: `${ENGINE_SET_TITLE[set]} on ${label}`,
    description: ENGINE_SET_DESCRIPTION[set] ?? `From the latest ${label} answer to each question.`,
    keys: picked.map((item) => item.key),
    insight:
      picked.length === 0
        ? null
        : picked.length === 1
          ? googleCited === 1
            ? 'Google AI Overview cites you here too.'
            : 'Google AI Overview does not cite you here.'
          : `Google AI Overview cites you in ${ofThese(googleCited, picked.length) ?? 'this one'}.`
  })
  // Now and Change are Google's: this list is the engine's own answers.
  const moves = set === 'moved'
  const pickedByKey = new Map(picked.map((item) => [item.key, item]))
  return {
    ...drill,
    columns: [],
    items: drill.items.map((item) => {
      const question = pickedByKey.get(item.id)
      const move = question ? rowOf(question)?.moved?.[engine] : undefined
      return { ...item, cells: {}, ...(moves && move ? { group: move } : {}) }
    }),
    ...(moves
      ? {
          summary: [
            { label: 'Gained', group: 'gained' },
            { label: 'Lost', group: 'lost' }
          ]
        }
      : {})
  }
}
