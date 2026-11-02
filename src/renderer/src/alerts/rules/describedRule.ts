import { ALERT_RULE_WHENS, type AlertRuleWhen, type AlertScopeKind } from '@shared/ipc'
import type { ScopeOptions } from '../../scope'
import { SCOPE_KINDS, type RuleDraft } from './ruleModel'

/**
 * "✦ Describe it" → the rule's fields (pure). Main's `alertRule` kind answers with
 * one row (`name`, `when`, `score`, `competitor`, `scope`, `scope_ids`, `markets`,
 * `desktop`, `slack`, `email`, `delivery`, `note`); this checks each value against
 * what the drawer can pick before it fills anything. A page, group or market that is
 * not in the lists is left out, and an email address only goes in when it is one
 * already set up in Alerts. Nothing is saved: the user reviews and presses Save rule.
 */

export interface DescribedFill {
  patch: Partial<RuleDraft>
  /** Plain-words notes: Claude's own, then what was left out and why. */
  notes: string[]
}

export function fillFromDescribed(
  values: Readonly<Record<string, string>>,
  context: {
    options: ScopeOptions | null
    /** Addresses already set up: the check summary's and the saved rules'. */
    emails: readonly string[]
    slackReady: boolean
  }
): DescribedFill | null {
  const when = values.when?.trim() ?? ''
  if (!(ALERT_RULE_WHENS as readonly string[]).includes(when)) return null
  const notes: string[] = []
  const note = values.note?.trim()
  if (note) notes.push(note)
  const patch: Partial<RuleDraft> = { when: when as AlertRuleWhen }
  const name = values.name?.trim()
  if (name) patch.name = name

  const score = Number(values.score?.trim() || 'NaN')
  if (when === 'score_drop' && Number.isInteger(score) && score >= 1 && score <= 100) {
    patch.scoreDrop = score
    patch.scoreText = String(score)
  }
  patch.competitorDomain =
    when === 'competitor_cited' && values.competitor?.trim() ? values.competitor.trim() : null

  const options = context.options
  const kindText = values.scope?.trim() ?? 'tracked'
  const kind = (SCOPE_KINDS as readonly string[]).includes(kindText)
    ? (kindText as AlertScopeKind)
    : 'tracked'
  if (kind === 'tracked') {
    patch.scope = { kind, ids: [] }
  } else if (options !== null) {
    const known = new Set(poolOf(kind, options))
    const ids = list(values.scope_ids).filter((id) => known.has(id))
    if (ids.length > 0) {
      patch.scope = { kind, ids }
    } else {
      patch.scope = { kind: 'tracked', ids: [] }
      notes.push(
        'The pages it named were not found, so it watches every tracked page. Pick them below.'
      )
    }
  }
  if (options !== null) {
    const markets = new Set(options.markets.map((market) => market.id))
    patch.marketIds = list(values.markets).filter((id) => markets.has(id))
  }

  patch.desktop = values.desktop === 'yes'
  const slack = values.slack === 'yes'
  patch.slack = slack && context.slackReady
  if (slack && !context.slackReady) notes.push('Slack is not set up yet, so it is left off.')
  const allowed = new Set(context.emails.map((email) => email.toLowerCase()))
  const emails = list(values.email)
  patch.emailTo = emails.filter((email) => allowed.has(email.toLowerCase()))
  if (patch.emailTo.length < emails.length) {
    notes.push('Only addresses already set up in Alerts are filled in.')
  }
  if (!patch.desktop && !patch.slack && patch.emailTo.length === 0) patch.desktop = true
  patch.delivery = values.delivery === 'digest' ? 'digest' : 'instant'
  return { patch, notes }
}

function poolOf(kind: AlertScopeKind, options: ScopeOptions): string[] {
  switch (kind) {
    case 'pages':
      return options.pages.filter((page) => page.tracked).map((page) => page.id)
    case 'group':
      return options.groups.map((item) => item.id)
    case 'cluster':
      return options.clusters.map((item) => item.id)
    case 'topic':
      return options.topics.map((item) => item.id)
    default:
      return []
  }
}

function list(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
