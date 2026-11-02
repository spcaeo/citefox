import { useMemo } from 'react'
import type { AlertRule, AlertRuleStatus } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useBuildTools } from '../../buildMenu/buildClient'
import { errorText } from '../../components/errorText'
import { openDrawer } from '../../shell/drawers'
import { alertsHash, navigateHash } from '../../shell/routes'
import type { RuleActions } from './RulesTab'
import type { RulesClient } from './rulesClient'

/** The Alert log, filtered to one rule: `#/alerts/log?log.f=<ruleId>`. */
export function ruleLogHash(ruleId: string): string {
  return `${alertsHash('log')}?${new URLSearchParams({ 'log.f': ruleId }).toString()}`
}

/** Opens the rule drawer for an existing rule (`drawer=alert-rule&rule.id=<id>`). */
export function openRule(ruleId: string): void {
  openDrawer('alert-rule', { 'rule.id': ruleId })
}

/**
 * What the Alert rules list does: open the drawer (new, edit, duplicate) on the URL,
 * pause, resume and delete through `alerts:*`, then reload and say what happened.
 */
export function useRuleActions(
  client: RulesClient,
  projectId: string | null,
  reload: () => void
): RuleActions {
  const { notify } = useBuildTools()
  return useMemo<RuleActions>(() => {
    const named = (rules: readonly AlertRule[]): string =>
      rules.length === 1 ? `“${rules[0]?.name ?? ''}”` : pluralize(rules.length, 'rule')
    return {
      create: () => openDrawer('alert-rule', { 'rule.id': 'new' }),
      edit: (rule) => openRule(rule.id),
      duplicate: (rule) => openDrawer('alert-rule', { 'rule.id': 'new', 'rule.from': rule.id }),
      openLog: (rule) => navigateHash(ruleLogHash(rule.id)),
      setStatus: async (rules: readonly AlertRule[], status: AlertRuleStatus) => {
        if (projectId === null || rules.length === 0) return
        try {
          await client.setStatus(
            projectId,
            rules.map((rule) => rule.id),
            status
          )
          notify(status === 'paused' ? `Paused ${named(rules)}.` : `Resumed ${named(rules)}.`, 'ok')
        } catch (cause) {
          notify(errorText(cause, 'The rules were not changed.'), 'bad')
        }
        reload()
      },
      remove: async (rules: readonly AlertRule[]) => {
        if (projectId === null || rules.length === 0) return
        try {
          await client.remove(
            projectId,
            rules.map((rule) => rule.id)
          )
          notify(`Deleted ${named(rules)}.`, 'ok')
        } catch (cause) {
          notify(errorText(cause, 'The rules were not deleted.'), 'bad')
        }
        reload()
      }
    }
  }, [client, projectId, reload, notify])
}
