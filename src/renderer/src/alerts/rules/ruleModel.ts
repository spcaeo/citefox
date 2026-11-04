import {
  DEFAULT_SCORE_DROP,
  type AlertDelivery,
  type AlertRule,
  type AlertRuleInput,
  type AlertRuleWhen,
  type AlertScopeKind
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { Market } from '@shared/domain'
import { marketLabel } from '../../shell/model'
import type { Scope, ScopeOptions } from '../../scope'
import { formatMoment } from '../../utils/dates'

/**
 * The When list, in the drawer's order, with the words the list and the drawer use:
 * the app's result words (Target page, Your other page, Not cited, No AI Overview).
 */
export const WHEN_OPTIONS: readonly { id: AlertRuleWhen; label: string; hint: string }[] = [
  {
    id: 'citation_lost',
    label: 'Target page no longer cited',
    hint: 'A question that cited the target page is Not cited now.'
  },
  {
    id: 'citation_gained',
    label: 'Right page cited',
    hint: 'A question that was Not cited now cites the target page.'
  },
  {
    id: 'score_drop',
    label: 'Score drops by N or more',
    hint: 'The page’s visibility score falls by at least this many points since the last check.'
  },
  {
    id: 'competitor_cited',
    label: 'Competitor is cited instead',
    hint: 'A competitor is cited on a question where your target page is Not cited.'
  },
  {
    id: 'wrong_page',
    label: 'Your other page cited',
    hint: 'Another page of your site is cited where the target page should be.'
  },
  {
    id: 'check_failed',
    label: 'Check failed',
    hint: 'The check ended in an error, or every question failed.'
  },
  {
    id: 'aio_gone',
    label: 'No AI Overview any more',
    hint: 'A question that showed an AI Overview now has No AI Overview.'
  }
]

export const SCOPE_KINDS: readonly AlertScopeKind[] = [
  'tracked',
  'pages',
  'group',
  'cluster',
  'topic'
]

/** The rule as the drawer edits it: text fields stay text until Save. */
export interface RuleDraft extends AlertRuleInput {
  /** Typed into the score field; checked on save. */
  scoreText: string
  /** Typed into the email chip box and not yet a chip. */
  emailDraft: string
}

export function newDraft(
  defaults: { emailTo?: readonly string[]; slackReady?: boolean } = {}
): RuleDraft {
  return {
    name: '',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: [...(defaults.emailTo ?? [])],
    slack: false,
    delivery: 'instant',
    scoreText: String(DEFAULT_SCORE_DROP),
    emailDraft: ''
  }
}

export function draftFrom(rule: AlertRule, copy = false): RuleDraft {
  return {
    name: copy ? `${rule.name} (copy)` : rule.name,
    when: rule.when,
    scoreDrop: rule.scoreDrop,
    competitorDomain: rule.competitorDomain,
    scope: { kind: rule.scope.kind, ids: [...rule.scope.ids] },
    marketIds: [...rule.marketIds],
    desktop: rule.desktop,
    emailTo: [...rule.emailTo],
    slack: rule.slack,
    delivery: rule.delivery,
    scoreText: String(rule.scoreDrop ?? DEFAULT_SCORE_DROP),
    emailDraft: ''
  }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export interface DraftCheck {
  input: AlertRuleInput | null
  /** Field → what to fix. */
  issues: Partial<Record<'name' | 'score' | 'scope' | 'email' | 'sendTo' | 'competitor', string>>
}

/** What Save would send, or the fields to fix first. A typed but unadded email counts. */
export function checkDraft(draft: RuleDraft, fallbackName: string): DraftCheck {
  const issues: DraftCheck['issues'] = {}
  const typed = draft.emailDraft
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const emails = [...draft.emailTo, ...typed.filter((item) => !draft.emailTo.includes(item))]
  const bad = emails.find((item) => !EMAIL.test(item))
  if (bad !== undefined) issues.email = `“${bad}” is not an email address.`
  let scoreDrop: number | null = null
  if (draft.when === 'score_drop') {
    const value = Number(draft.scoreText)
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      issues.score = 'Type a whole number from 1 to 100.'
    } else {
      scoreDrop = value
    }
  }
  let competitorDomain: string | null = null
  if (draft.when === 'competitor_cited' && (draft.competitorDomain ?? '').trim() !== '') {
    const domain = bareDomain(draft.competitorDomain ?? '')
    if (!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain)) {
      issues.competitor = 'Type a domain, such as competitor.example.com.'
    } else {
      competitorDomain = domain
    }
  }
  if (draft.scope.kind !== 'tracked' && draft.scope.ids.length === 0) {
    issues.scope = 'Pick at least one.'
  }
  if (!draft.desktop && !draft.slack && emails.length === 0) {
    issues.sendTo = 'Choose where the alert goes: desktop, email or Slack.'
  }
  const name = draft.name.trim() || fallbackName
  if (name.length > 120) issues.name = 'Keep the name under 120 characters.'
  if (Object.keys(issues).length > 0) return { input: null, issues }
  return {
    issues,
    input: {
      name,
      when: draft.when,
      scoreDrop,
      competitorDomain,
      scope: draft.scope,
      marketIds: draft.marketIds,
      desktop: draft.desktop,
      emailTo: emails,
      slack: draft.slack,
      delivery: draft.delivery
    }
  }
}

export function bareDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
}

/** "Target page no longer cited", "Score drops by 10 or more", "twilio.com is cited instead". */
export function whenText(
  rule: Pick<AlertRuleInput, 'when' | 'scoreDrop' | 'competitorDomain'>
): string {
  switch (rule.when) {
    case 'score_drop':
      return `Score drops by ${rule.scoreDrop ?? DEFAULT_SCORE_DROP} or more`
    case 'competitor_cited':
      return rule.competitorDomain
        ? `${rule.competitorDomain} is cited instead`
        : 'A competitor is cited instead'
    default:
      return WHEN_OPTIONS.find((option) => option.id === rule.when)?.label ?? rule.when
  }
}

/** The name a rule gets when none is typed. */
export function suggestedName(draft: RuleDraft, options: ScopeOptions | null): string {
  const scope = scopeText(draft.scope, options)
  const what = whenText({
    when: draft.when,
    scoreDrop: draft.when === 'score_drop' ? Number(draft.scoreText) || DEFAULT_SCORE_DROP : null,
    competitorDomain: draft.competitorDomain
  })
  return scope === 'All tracked pages' ? what : `${what} · ${scope}`
}

/** "All tracked pages", "3 pages", "Group: Money pages", "2 clusters". */
export function scopeText(scope: Scope | AlertRule['scope'], options: ScopeOptions | null): string {
  const ids = scope.ids
  switch (scope.kind) {
    case 'tracked':
      return 'All tracked pages'
    case 'pages': {
      if (ids.length === 1) {
        const page = options?.pages.find((item) => item.id === ids[0])
        if (page) return page.label
      }
      return pluralize(ids.length, 'page')
    }
    case 'group':
    case 'cluster':
    case 'topic': {
      const sets =
        scope.kind === 'group'
          ? options?.groups
          : scope.kind === 'cluster'
            ? options?.clusters
            : options?.topics
      const noun = scope.kind === 'group' ? 'Group' : scope.kind === 'cluster' ? 'Cluster' : 'Topic'
      if (ids.length === 1) {
        const set = sets?.find((item) => item.id === ids[0])
        if (set) return `${noun}: ${set.name}`
      }
      return pluralize(ids.length, noun.toLowerCase())
    }
    default:
      return pluralize(ids.length, 'item')
  }
}

export function marketsText(ids: readonly string[], markets: readonly Market[]): string {
  if (ids.length === 0) return 'All markets'
  const labels = ids.map((id) => {
    const market = markets.find((item) => item.id === id)
    return market ? marketLabel(market) : id
  })
  return labels.length <= 2 ? labels.join(', ') : `${labels.length} markets`
}

export function sendToText(rule: Pick<AlertRuleInput, 'desktop' | 'emailTo' | 'slack'>): string {
  const parts: string[] = []
  if (rule.desktop) parts.push('Desktop')
  if (rule.emailTo.length === 1) parts.push(rule.emailTo[0] ?? 'Email')
  else if (rule.emailTo.length > 1) parts.push(`${rule.emailTo.length} emails`)
  if (rule.slack) parts.push('Slack')
  return parts.length > 0 ? parts.join(' · ') : 'Nowhere'
}

export function deliveryText(delivery: AlertDelivery): string {
  return delivery === 'digest' ? 'Daily digest' : 'Right away'
}

/** "Would have fired 3 times in the last 30 days". */
export function dryRunText(fired: number, days: number): string {
  if (fired === 0) return `Would not have fired in the last ${days} days`
  return `Would have fired ${fired === 1 ? 'once' : `${fired.toLocaleString('en-US')} times`} in the last ${days} days`
}

/** "Oct 20, 2:05 PM": on the computer's clock, in the person's time zone. */
export function shortWhen(iso: string, timeZone?: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso
  return formatMoment(iso, timeZone ? { timeZone } : {})
}

/** A page's path for narrow places; Copy and Open keep the full URL. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}
