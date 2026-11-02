import { formatRuleRefs, readDescribedRule, readRuleRefs } from '../../alerts/rule-refs'
import { AssistInputError, type AssistDefinition } from '../types'
import { projectOf } from './gather'

/**
 * Alerts → alert rule → "✦ Describe it" (HelpFill.dc.html panel 7, Alert rules): the
 * user's sentence ("Tell me when a competitor overtakes us on pricing questions")
 * becomes one rule for the drawer to show. Claude picks only from listed ids and
 * refs; email addresses are E1, E2… so it can never invent or see one. Nothing is
 * saved: the drawer's Save does that.
 */
export const ALERT_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'alerts.describeRule',
    title: 'Describe the rule',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    minItems: 3,
    maxItems: 8,
    task: `Turn what the user asked for into one alert rule, using only the ids and refs listed below.
Give one item per field, each with the field name as its tag:
- tag "name": a short rule name, at most 60 characters.
- tag "when": one id from "What a rule can watch".
- tag "competitor": only for competitor_cited: a domain from "Competitors", or any.
- tag "score": only for score_drop: a whole number from 1 to 100.
- tag "scope": text is tracked, pages, group, cluster or topic; detail lists the refs it watches, comma separated (null for tracked).
- tag "markets": all, or market refs, comma separated.
- tag "send": where the alert goes, comma separated: desktop, slack (only when Slack is set up) and email refs. Never write an email address.
- tag "delivery": instant, or digest for one message a day.
Pick the closest group, cluster, topic or pages for what the user names; when nothing fits, watch all tracked pages and say so in caution.
summary: the rule in one plain sentence. caution: what you could not match to a listed id, else null.`,
    gather(context) {
      const instruction = context.request.instruction?.trim() ?? ''
      if (instruction.length === 0) {
        throw new AssistInputError(
          'Say what to watch first.',
          'Type what the rule should tell you.'
        )
      }
      const opened = projectOf(context)
      return formatRuleRefs(readRuleRefs(opened.db, opened.project.id))
    },
    check(reply, context) {
      const opened = projectOf(context)
      const read = readDescribedRule(reply.items, readRuleRefs(opened.db, opened.project.id))
      return 'problem' in read ? read.problem : null
    }
  }
]
