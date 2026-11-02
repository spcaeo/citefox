import {
  ALERT_RULE_WHENS,
  ALERT_SCOPE_KINDS,
  type AlertDelivery,
  type AlertRuleWhen,
  type AlertScopeKind
} from '@shared/ipc'
import { competitorContext } from '../engine/competitor-context'
import { getAlertSettings } from '../storage/alert-settings'
import { listAlertRules } from '../storage/alert-rules'
import { listClusters } from '../storage/cluster-records'
import type { SqliteDatabase } from '../storage/database'
import { listGroups } from '../storage/group-records'
import { listPages } from '../storage/pages'
import { listMarkets } from '../storage/project-profile'

/**
 * Alert rule → "✦ Describe it": what Claude may pick from, as short refs (P1 for a
 * page, E1 for an email address), and the reading of its answer back into a rule
 * for the drawer to show. Claude never sees an email address: only E1, E2… for the
 * addresses already set up, so a rule can only send to one of those.
 */

/** Pages listed for Claude; a bigger site is matched by its groups, clusters and topics. */
const PAGES_MAX = 80

export interface RuleRef {
  ref: string
  id: string
  label: string
}

export interface RuleRefs {
  pages: RuleRef[]
  groups: RuleRef[]
  clusters: RuleRef[]
  topics: RuleRef[]
  markets: RuleRef[]
  /** `label` is the address itself: kept in main, never put in a prompt. */
  emails: RuleRef[]
  competitors: string[]
  slackReady: boolean
}

/** What each "when" watches, in the drawer's words. */
export const WHEN_MEANING: Readonly<Record<AlertRuleWhen, string>> = {
  citation_lost:
    'Target page no longer cited: a question that cited the target page is Not cited now.',
  citation_gained: 'Right page cited: a question that was Not cited now cites the right page.',
  score_drop: 'Score drops by N or more points since the last check.',
  competitor_cited:
    'Competitor is cited instead: a competitor is cited on a question where your target page is Not cited.',
  wrong_page:
    'Your other page cited: another page of your site is cited where the target page should be.',
  check_failed: 'Check failed: the check ended in an error, or every question failed.',
  aio_gone: 'No AI Overview any more: a question that showed an AI Overview now has none.'
}

export function readRuleRefs(db: SqliteDatabase, projectId: string): RuleRefs {
  const pages = listPages(db, projectId).filter((page) => page.status === 'tracked')
  const settings = getAlertSettings(db, projectId)
  const addresses = [
    ...new Set([
      ...settings.emailTo,
      ...listAlertRules(db, projectId).flatMap((rule) => rule.emailTo)
    ])
  ]
  const context = competitorContext(db, {})
  const refs = <T>(
    prefix: string,
    items: readonly T[],
    id: (item: T) => string,
    label: (item: T) => string
  ): RuleRef[] =>
    items.map((item, index) => ({ ref: `${prefix}${index + 1}`, id: id(item), label: label(item) }))
  return {
    pages: refs(
      'P',
      pages.filter((page) => page.kind !== 'topic').slice(0, PAGES_MAX),
      (page) => page.id,
      (page) => [pathOf(page.url ?? ''), page.label ?? page.title].filter(Boolean).join(' · ')
    ),
    groups: refs(
      'G',
      listGroups(db),
      (group) => group.id,
      (group) => group.name
    ),
    clusters: refs(
      'C',
      listClusters(db),
      (cluster) => cluster.id,
      (cluster) => cluster.name
    ),
    topics: refs(
      'T',
      pages.filter((page) => page.kind === 'topic'),
      (page) => page.id,
      (page) => page.label ?? page.title ?? page.id
    ),
    markets: refs(
      'M',
      listMarkets(db),
      (market) => market.id,
      (market) => `${market.country} · ${market.language}`
    ),
    emails: refs(
      'E',
      addresses,
      (address) => address,
      (address) => address
    ),
    competitors: [...context.direct, ...context.partial]
      .map((item) => item.domain)
      .filter((domain): domain is string => domain !== null && domain.length > 0),
    slackReady: settings.slackKeychainRef !== null
  }
}

/** The refs as the assist's facts: ids and names, the addresses only as E1, E2… */
export function formatRuleRefs(refs: RuleRefs): string {
  const list = (title: string, items: readonly RuleRef[]): string[] =>
    items.length === 0
      ? [`${title}: none`]
      : [`${title}:`, ...items.map((item) => `- ${item.ref}: ${item.label}`)]
  return [
    'What a rule can watch (when), one id:',
    ...ALERT_RULE_WHENS.map((when) => `- ${when}: ${WHEN_MEANING[when]}`),
    '',
    ...list('Tracked pages', refs.pages),
    ...list('Groups', refs.groups),
    ...list('Clusters', refs.clusters),
    ...list('Topics', refs.topics),
    ...list('Markets', refs.markets),
    `Competitors (domains): ${refs.competitors.join(', ') || 'none saved'}`,
    `Email addresses already set up: ${refs.emails.map((item) => item.ref).join(', ') || 'none'}`,
    `Slack: ${refs.slackReady ? 'set up' : 'not set up'}`
  ].join('\n')
}

/** A described rule, as the drawer fills it in. Ids and addresses are real; nothing is saved. */
export interface DescribedRule {
  name: string
  when: AlertRuleWhen
  scoreDrop: number | null
  competitorDomain: string | null
  scope: { kind: AlertScopeKind; ids: string[] }
  marketIds: string[]
  desktop: boolean
  slack: boolean
  emailTo: string[]
  delivery: AlertDelivery
}

interface ReplyItem {
  text: string
  detail: string | null
  tag: string | null
}

/** Claude's answer as a rule, or the sentence that says what to fix. */
export function readDescribedRule(
  items: readonly ReplyItem[],
  refs: RuleRefs
): { rule: DescribedRule } | { problem: string } {
  const field = (tag: string): ReplyItem | undefined =>
    items.find((item) => item.tag?.trim().toLowerCase() === tag)
  const when = field('when')?.text.trim().toLowerCase() ?? ''
  if (!(ALERT_RULE_WHENS as readonly string[]).includes(when)) {
    return { problem: `Give tag "when" one of: ${ALERT_RULE_WHENS.join(', ')}.` }
  }
  const kindText = field('scope')?.text.trim().toLowerCase() ?? 'tracked'
  const kind = (ALERT_SCOPE_KINDS as readonly string[]).includes(kindText)
    ? (kindText as AlertScopeKind)
    : null
  if (kind === null) return { problem: `Give tag "scope" one of: ${ALERT_SCOPE_KINDS.join(', ')}.` }
  const pool =
    kind === 'pages'
      ? refs.pages
      : kind === 'group'
        ? refs.groups
        : kind === 'cluster'
          ? refs.clusters
          : kind === 'topic'
            ? refs.topics
            : []
  const scopeIds = kind === 'tracked' ? [] : resolve(field('scope')?.detail ?? '', pool)
  if (scopeIds === null || (kind !== 'tracked' && scopeIds.length === 0)) {
    return { problem: 'List the scope refs in the scope item’s detail, from the lists given.' }
  }
  const marketText = field('markets')?.text.trim().toLowerCase() ?? 'all'
  const marketIds =
    marketText === 'all' || marketText === '' ? [] : resolve(marketText, refs.markets)
  if (marketIds === null) return { problem: 'Give "markets" as all or market refs from the list.' }
  const send = splitRefs(field('send')?.text ?? 'desktop').map((part) => part.toLowerCase())
  const emailRefs = send.filter((part) => /^e\d+$/u.test(part))
  const emails = resolve(emailRefs.join(','), refs.emails)
  if (emails === null || send.some((part) => part.includes('@'))) {
    return { problem: 'Send email only to the E refs listed. Never write an address.' }
  }
  const slack = send.includes('slack') && refs.slackReady
  const desktop = send.includes('desktop') || (!slack && emails.length === 0)
  let scoreDrop: number | null = null
  if (when === 'score_drop') {
    const value = Number(field('score')?.text.trim() ?? '10')
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return { problem: 'Give "score" a whole number from 1 to 100.' }
    }
    scoreDrop = value
  }
  let competitorDomain: string | null = null
  const competitor = field('competitor')?.text.trim().toLowerCase() ?? 'any'
  if (when === 'competitor_cited' && competitor !== 'any' && competitor !== '') {
    if (!refs.competitors.includes(competitor)) {
      return { problem: 'Give "competitor" a domain from the Competitors list, or any.' }
    }
    competitorDomain = competitor
  }
  const delivery = field('delivery')?.text.trim().toLowerCase() === 'digest' ? 'digest' : 'instant'
  const name = (field('name')?.text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120)
  return {
    rule: {
      name,
      when: when as AlertRuleWhen,
      scoreDrop,
      competitorDomain,
      scope: { kind, ids: scopeIds },
      marketIds,
      desktop,
      slack,
      emailTo: emails,
      delivery
    }
  }
}

function splitRefs(text: string): string[] {
  return text
    .split(/[,;\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Refs to ids, each once; null when one is not in the list. */
function resolve(text: string, pool: readonly RuleRef[]): string[] | null {
  const ids: string[] = []
  for (const part of splitRefs(text)) {
    const found = pool.find((item) => item.ref.toLowerCase() === part.toLowerCase())
    if (found === undefined) return null
    if (!ids.includes(found.id)) ids.push(found.id)
  }
  return ids
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}
