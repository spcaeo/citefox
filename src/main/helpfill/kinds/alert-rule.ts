import { readDescribedRule, readRuleRefs } from '../../alerts/rule-refs'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { withProject } from '../../engine/project-db'
import type { HelpFillKindDef } from '../types'

/**
 * Alerts → alert rule → "✦ Describe it", Describe only (HelpFill.dc.html panel 7,
 * Alert rules: "not needed" for the chatbot way). The `alerts.describeRule` assist
 * turns the user's sentence into one rule; it comes back as one row for the drawer to
 * fill its fields with, for review. Email addresses are only ever ones already set up
 * (Claude picks E1, E2…; main maps them back). Nothing is saved.
 */

/** The one row's columns. `scope_ids`, `markets` and `email` are comma lists; flags are yes/no. */
export const ALERT_RULE_COLUMNS = [
  'name',
  'when',
  'score',
  'competitor',
  'scope',
  'scope_ids',
  'markets',
  'desktop',
  'slack',
  'email',
  'delivery',
  'note'
] as const

export const ALERT_RULE_KIND: HelpFillKindDef = {
  kind: 'alertRule',
  noun: ['rule', 'rules'],
  scope: 'project',
  sections: [{ id: 'main', title: null, columns: ALERT_RULE_COLUMNS, entity: null }],
  neutral: false,
  defaultCount: 1,
  maxCount: 1,
  chatbotCount: 1,
  describeCost: { calls: 1, usd: 0.01 },
  // The chatbot way is not offered here; the prompt is a plain fallback only.
  role: () => 'You help a company set up one alert for its Google AI Overview tracking.',
  task: () => ['Describe the alert in one sentence.'],
  tracked: () => ({ listed: [], merge: {} }),
  async describe(host, context, input) {
    ensureShippedAssists()
    const result = await runAssist(host, {
      assistId: 'alerts.describeRule',
      projectId: context.projectId,
      pageId: null,
      marketId: null,
      promptId: null,
      inputs: {},
      instruction: input.sentence.trim() || null
    })
    const refs = await withProject(host, context.projectId, 'helpfill:describe', ({ db }) =>
      readRuleRefs(db, context.projectId)
    )
    const read = readDescribedRule(result.items, refs)
    if ('problem' in read) return []
    const rule = read.rule
    const yes = (value: boolean): string => (value ? 'yes' : 'no')
    return [
      {
        section: null,
        values: {
          name: rule.name || 'Described rule',
          when: rule.when,
          score: rule.scoreDrop === null ? '' : String(rule.scoreDrop),
          competitor: rule.competitorDomain ?? '',
          scope: rule.scope.kind,
          scope_ids: rule.scope.ids.join(','),
          markets: rule.marketIds.join(','),
          desktop: yes(rule.desktop),
          slack: yes(rule.slack),
          email: rule.emailTo.join(','),
          delivery: rule.delivery,
          note: [result.summary, result.caution].filter(Boolean).join(' ')
        }
      }
    ]
  }
}
