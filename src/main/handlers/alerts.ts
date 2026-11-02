/** Alert rules, the dry run and the alert log (Alerts & schedules › Alert rules, Alert log). */

import type { alertsChannels, IpcHandlersFor } from '@shared/ipc'
import {
  parseDryRun,
  parseLogRequest,
  parseRuleIds,
  parseRuleProjectId,
  parseSaveRule,
  parseSetStatus
} from '../alerts/parse'
import type { AlertRulesService } from '../alerts/service'
import { guard, type EngineContext } from './context'

/** `alerts:get`, `alerts:update` and `alerts:testSlack` are bound with the email service. */
type RuleChannels = Omit<
  IpcHandlersFor<typeof alertsChannels>,
  'alerts:get' | 'alerts:update' | 'alerts:testSlack'
>

export function alertRuleHandlers(ctx: EngineContext, rules: AlertRulesService): RuleChannels {
  return {
    'alerts:listRules': (request) =>
      guard('alerts:listRules', ctx, () =>
        rules.listRules(parseRuleProjectId(request, 'alerts:listRules'), 'alerts:listRules')
      ),
    'alerts:saveRule': (request) =>
      guard('alerts:saveRule', ctx, () => rules.saveRule(parseSaveRule(request))),
    'alerts:deleteRule': (request) =>
      guard('alerts:deleteRule', ctx, () => {
        const parsed = parseRuleIds(request, 'alerts:deleteRule')
        return rules.deleteRules(parsed.projectId, parsed.ids)
      }),
    'alerts:setRuleStatus': (request) =>
      guard('alerts:setRuleStatus', ctx, () => rules.setStatus(parseSetStatus(request))),
    'alerts:dryRun': (request) =>
      guard('alerts:dryRun', ctx, () => {
        const parsed = parseDryRun(request)
        return rules.dryRun(parsed.projectId, parsed.rule, parsed.days)
      }),
    'alerts:listLog': (request) =>
      guard('alerts:listLog', ctx, () => {
        const parsed = parseLogRequest(request)
        return rules.listLog(parsed.projectId, parsed.ruleId, parsed.limit)
      })
  }
}
