import type {
  CommunitiesReport,
  CommunityAio,
  CommunityLink,
  CommunitySourceBase,
  CommunityThread,
  Market
} from '@shared/domain'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../drill'
import { marketLabel } from '../shell/model'
import { mdLink, mdText, shortUrl } from '../sentiment/utils/markdown'
import { formatDay, formatMoment } from '../utils/dates'
import {
  marketName,
  ownerLabel,
  plural,
  replyLabel,
  resolveDrill,
  signedChange,
  sourceTypeLabel,
  statusLabel
} from './utils/model'

/** What a drill is called. `id` is the NFR-14 id the opener carries. */
export interface DrillCopy {
  id: string
  title: string
  /** Markdown under the title. */
  description: string
  omitCount?: boolean
}

/**
 * The Communities tab's drills, all in the shared drawer. An answer count
 * lists those answers (each opens Prompt detail in its market and check); a
 * citation count lists those links (each opens in the browser, its prompt in
 * Prompt detail); a page count lists those pages. Every list holds exactly
 * the items the number counts (NFR-14).
 */
export interface CommunityDrills {
  answers(copy: DrillCopy, keys: readonly string[]): ItemDrill
  links(copy: DrillCopy, links: readonly CommunityLink[], groupBy?: 'owner' | 'type'): ItemDrill
  /** Distinct tracked pages among the answers (project scope "N pages"). */
  pages(copy: DrillCopy, keys: readonly string[]): ItemDrill
  threads(copy: DrillCopy, threads: readonly CommunityThread[]): ItemDrill
  /** Citations of a type gained and lost between two check columns. */
  change(
    copy: Omit<DrillCopy, 'omitCount'>,
    links: { before: readonly CommunityLink[]; after: readonly CommunityLink[] }
  ): ItemDrill
  /** Prompt detail for one answer, in its market and check. */
  answerTarget(aio: CommunityAio): DrillTarget
  aio(key: string): CommunityAio | undefined
}

// The drawer can be 440px wide: the first column plus two narrow ones fit.
const ANSWER_COLUMNS = [
  { id: 'status', label: 'Your page', width: 'minmax(96px, 0.8fr)' },
  { id: 'checked', label: 'Checked', width: '64px' }
] as const

// Project scope has no "your page": each answer's status is about the page
// its prompt is tracked for, which the row's first line names.
const PROJECT_ANSWER_COLUMNS = [
  { id: 'status', label: 'Its page', width: 'minmax(96px, 0.8fr)' },
  { id: 'checked', label: 'Checked', width: '64px' }
] as const

const LINK_COLUMNS = [
  { id: 'source', label: 'Source', width: 'minmax(96px, 0.8fr)' },
  { id: 'position', label: 'Pos.', align: 'end', width: '48px' }
] as const

const PAGE_COLUMNS = [{ id: 'answers', label: 'Answers', align: 'end', width: '72px' }] as const

const THREAD_COLUMNS = [
  { id: 'reply', label: 'Can we reply?', width: '96px' },
  { id: 'cited', label: 'Cited', align: 'end', width: '56px' }
] as const

function scopeOf(report: CommunitiesReport): DrillScope {
  const market: Market | undefined = report.markets.find((item) => item.id === report.marketId)
  return {
    pageId: report.scope === 'page' ? report.pageId : null,
    marketId: report.marketId,
    runId: null,
    marketLabel: market ? marketLabel(market) : 'All markets',
    checkDateLabel: '',
    brand: report.brandNames[0] ?? 'your brand',
    domain: report.domain
  }
}

export function createCommunityDrills(report: CommunitiesReport): CommunityDrills {
  const project = report.scope === 'project'
  const byKey = new Map(report.aios.map((aio) => [aio.key, aio] as const))
  const linksByKey = new Map<string, CommunityLink[]>()
  for (const link of report.links) {
    const list = linksByKey.get(link.aioKey) ?? []
    list.push(link)
    linksByKey.set(link.aioKey, list)
  }
  const scope = scopeOf(report)

  function answerTarget(aio: CommunityAio): DrillTarget {
    return {
      kind: 'prompt',
      pageId: aio.pageId,
      promptId: aio.promptId,
      marketId: aio.marketId,
      runId: aio.runId
    }
  }

  function promptLine(aio: CommunityAio): string {
    return `Question ${aio.promptPosition} · ${aio.label}${project ? ` · ${aio.pageLabel}` : ''}`
  }

  function answerItem(aio: CommunityAio): DrillItem {
    const sources = linksByKey.get(aio.key) ?? []
    return {
      id: aio.key,
      primary: promptLine(aio),
      secondary: `${marketName(report.markets, aio.marketId)} · ${aio.text}`,
      target: answerTarget(aio),
      cells: {
        status: `${statusLabel(aio.status)}${aio.named === true ? ' · named' : ''}`,
        checked: formatMoment(aio.checkedAt)
      },
      detail:
        sources.length === 0
          ? 'No sources are stored for this answer.'
          : `**Sources this overview cites, in order:**\n\n${sources
              .map(
                (link) =>
                  `${link.position}. ${mdLink(link.title ?? shortUrl(link.url), link.url)} · ${sourceTypeLabel(link.type)} · ${ownerLabel(link.owner)}`
              )
              .join('\n')}`,
      group: aio.status === 'page_cited' ? 'cited' : 'not_cited'
    }
  }

  function linkItem(link: CommunityLink, group: string): DrillItem {
    const aio = byKey.get(link.aioKey)
    return {
      id: `${link.aioKey}|${link.normalizedUrl}`,
      primary: link.title ?? shortUrl(link.url),
      url: link.url,
      secondary: aio ? `${promptLine(aio)} · ${marketName(report.markets, aio.marketId)}` : null,
      target: aio ? answerTarget(aio) : null,
      cells: {
        source: `${sourceTypeLabel(link.type)} · ${ownerLabel(link.owner)}`,
        position: link.position
      },
      group
    }
  }

  function linkSummary(
    items: readonly DrillItem[],
    groupBy: 'owner' | 'type' | 'change'
  ): { group: string; label: string }[] {
    const seen = [...new Set(items.map((item) => item.group ?? ''))].filter(Boolean)
    // One part is the whole list: the strip would only repeat the total.
    if (seen.length < 2) return []
    return seen.map((group) => ({
      group,
      label:
        groupBy === 'change'
          ? group === 'gained'
            ? 'Gained'
            : 'Lost'
          : groupBy === 'owner'
            ? ownerLabel(group as CommunityLink['owner'])
            : sourceTypeLabel(group as CommunityLink['type'])
    }))
  }

  const linkNote =
    'A link opens in your browser; its question opens Question detail in that market and check. Position is where the link sits in the overview’s sources (1 = first).'

  return {
    answers(copy, keys) {
      return {
        kind: 'items',
        ...copy,
        noun: ['answer', 'answers'],
        primaryLabel: 'Question',
        columns: project ? PROJECT_ANSWER_COLUMNS : ANSWER_COLUMNS,
        items: resolveDrill(report, keys).map(answerItem),
        summary: [
          { label: project ? 'Its page cited' : 'Your page cited', group: 'cited' },
          { label: 'Not cited', group: 'not_cited' }
        ],
        note: 'One answer is one buyer question’s AI Overview in one market and one check. Select a row to open Question detail, or expand it for the sources it cites.',
        scope
      }
    },
    links(copy, links, groupBy = 'owner') {
      const items = links.map((link) =>
        linkItem(link, groupBy === 'owner' ? link.owner : link.type)
      )
      return {
        kind: 'items',
        ...copy,
        noun: ['citation', 'citations'],
        primaryLabel: 'Link',
        columns: LINK_COLUMNS,
        items,
        summary: linkSummary(items, groupBy),
        note: linkNote,
        scope
      }
    },
    pages(copy, keys) {
      const groups = new Map<string, CommunityAio[]>()
      for (const aio of resolveDrill(report, keys)) {
        const list = groups.get(aio.pageId) ?? []
        list.push(aio)
        groups.set(aio.pageId, list)
      }
      return {
        kind: 'items',
        ...copy,
        noun: ['page', 'pages'],
        primaryLabel: 'Page',
        columns: PAGE_COLUMNS,
        items: [...groups.entries()].map(([pageId, aios]) => ({
          id: pageId,
          primary: aios[0]?.pageLabel ?? pageId,
          secondary: aios
            .map((aio) => `Question ${aio.promptPosition}`)
            .filter((value, index, list) => list.indexOf(value) === index)
            .join(', '),
          // The page's own tab, pinned to the market these numbers are for.
          target: {
            kind: 'page',
            pageId,
            tab: 'communities',
            ...(report.marketId !== null ? { marketId: report.marketId } : {})
          },
          cells: { answers: aios.length }
        })),
        note: 'Select a page to open its Communities tab in this market.',
        scope
      }
    },
    threads(copy, threads) {
      return {
        kind: 'items',
        ...copy,
        noun: ['thread', 'threads'],
        primaryLabel: 'Thread',
        columns: THREAD_COLUMNS,
        items: threads.map((thread) => ({
          id: thread.url,
          primary: thread.title ?? shortUrl(thread.url),
          url: thread.url,
          secondary: [
            thread.subreddit,
            thread.comments === null ? null : plural(thread.comments, 'comment'),
            thread.upvotes === null ? null : plural(thread.upvotes, 'upvote')
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
          cells: {
            reply: replyLabel(thread.replyState),
            cited: thread.timesCited
          },
          detail: threadFacts(thread)
        })),
        note: 'A thread opens in your browser. CiteFox never posts: you copy a draft and post it yourself.',
        scope
      }
    },
    change(copy, { before, after }) {
      const identity = (link: CommunityLink): string => {
        const aio = byKey.get(link.aioKey)
        return `${aio?.pageId ?? ''}|${aio?.marketId ?? ''}|${aio?.promptId ?? ''}|${link.normalizedUrl}`
      }
      const had = new Set(before.map(identity))
      const has = new Set(after.map(identity))
      const gained = after.filter((link) => !had.has(identity(link)))
      const lost = before.filter((link) => !has.has(identity(link)))
      const items = [
        ...gained.map((link) => linkItem(link, 'gained')),
        ...lost.map((link) => linkItem(link, 'lost'))
      ]
      return {
        kind: 'items',
        ...copy,
        title: `${copy.title}: ${signedChange(gained.length - lost.length)} (${plural(gained.length, 'gained', 'gained')}, ${plural(lost.length, 'lost', 'lost')})`,
        omitCount: true,
        noun: ['citation', 'citations'],
        primaryLabel: 'Link',
        columns: LINK_COLUMNS,
        items,
        summary: linkSummary(items, 'change'),
        note: `Gained: cited in the newer check for the same question and market, not the older one. Lost: the other way round. Gained − lost is the change. ${linkNote}`,
        scope
      }
    },
    answerTarget,
    aio: (key) => byKey.get(key)
  }
}

/** Markdown facts for a cited source's drawer: its link and what CiteFox knows about it. */
export function sourceFacts(row: CommunitySourceBase, kind: string): string {
  const name = row.title ?? shortUrl(row.url)
  return [
    `${mdLink(`Open the ${kind} in your browser`, row.url)} · ${mdText(name)}`,
    `Cited in ${plural(row.timesCited, 'answer')} in the newest check; ${plural(row.gap, 'answer')} of them cite nothing of yours. First seen ${formatMoment(row.firstSeenAt)}.`
  ].join('\n\n')
}

/** Markdown blockquote of stored text, one `>` line per paragraph, escaped. */
function mdQuote(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `> ${mdText(paragraph)}`)
    .join('\n>\n')
}

/**
 * Markdown facts for a Reddit thread: status, comments, upvotes, age, brand,
 * then the sentence that names the brand and the thread excerpt, when
 * Check threads kept them.
 */
export function threadFacts(thread: CommunityThread): string {
  const parts = [
    `**Can we reply?** ${replyLabel(thread.replyState)}${
      thread.checkedAt
        ? ` (checked ${formatMoment(thread.checkedAt)})`
        : ' (select Check threads to read it)'
    }`,
    thread.subreddit ? `**Subreddit:** ${mdText(thread.subreddit)}` : null,
    thread.comments !== null ? `**Comments:** ${thread.comments.toLocaleString('en-US')}` : null,
    thread.upvotes !== null ? `**Upvotes:** ${thread.upvotes.toLocaleString('en-US')}` : null,
    thread.postedAt ? `**Posted:** ${formatDay(thread.postedAt)}` : null,
    thread.brandInThread === null
      ? null
      : `**Brand in thread:** ${thread.brandInThread ? 'yes, in the title, post or comments' : 'no'}`
  ].filter((part): part is string => part !== null)
  const blocks = [parts.join(' · ')]
  if (thread.brandInThread === true && thread.brandQuote) {
    blocks.push('**Where the thread names your brand:**', mdQuote(thread.brandQuote))
  }
  if (thread.excerpt) {
    blocks.push('**From the thread (title and top post):**', mdQuote(thread.excerpt))
  }
  return blocks.join('\n\n')
}
