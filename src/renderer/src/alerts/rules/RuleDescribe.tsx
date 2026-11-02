import { useState, type JSX } from 'react'
import type { ScopeOptions } from '../../scope'
import { DrawerSection, HelpFill, type HelpFillSource } from '../../ui'
import { fillFromDescribed } from './describedRule'
import type { RuleDraft } from './ruleModel'

const NOOP = (): void => undefined

const CHIPS = [
  {
    id: 'overtake',
    label: 'A competitor overtakes us',
    text: 'Tell me when a competitor overtakes us on pricing questions'
  },
  {
    id: 'lost',
    label: 'We lose a citation',
    text: 'Email me right away when any tracked page loses a citation'
  },
  {
    id: 'score',
    label: 'A big score drop',
    text: 'A daily digest when a page’s score drops by 15 or more'
  }
]

/**
 * A new alert rule's "✦ Describe it" (HelpFill.dc.html panel 7, Describe only: there
 * is no chatbot way for a rule). One sentence in; the `alertRule` kind answers with
 * one rule and the drawer's fields fill in below, for review before Save rule.
 */
export function RuleDescribe({
  projectId,
  source,
  options,
  emails,
  slackReady,
  disabled,
  onFill
}: {
  projectId: string
  source: HelpFillSource
  options: ScopeOptions | null
  emails: readonly string[]
  slackReady: boolean
  disabled: boolean
  onFill: (patch: Partial<RuleDraft>) => void
}): JSX.Element {
  const [notes, setNotes] = useState<string[] | null>(null)
  return (
    <DrawerSection
      title="✦ Describe it"
      description="Say what to watch in a sentence. CiteFox fills in the rule below for you to check; nothing is saved until you press Save rule."
      testId="rule-describe"
    >
      <HelpFill
        kind="alertRule"
        projectId={projectId}
        scope={{ pageId: null }}
        source={source}
        way={null}
        onWay={NOOP}
        bot={null}
        onBot={NOOP}
        only="describe"
        // The note below says what was filled in; the kit's row count would only repeat it.
        banner={false}
        disabled={disabled}
        describe={{
          label: 'What should this rule tell you?',
          placeholder: 'For example: tell me when a competitor overtakes us on pricing questions.',
          chips: CHIPS,
          buttonLabel: () => 'Fill in the rule'
        }}
        onRows={(result) => {
          const values = result.rows[0]?.values
          const fill = values ? fillFromDescribed(values, { options, emails, slackReady }) : null
          if (fill === null) {
            setNotes([
              'CiteFox could not read a rule from that. Try saying what should happen, and where.'
            ])
            return
          }
          onFill(fill.patch)
          setNotes(['Filled in below. Check each field, then Save rule.', ...fill.notes])
        }}
        testId="rule-hf"
      />
      {notes !== null ? (
        <p className="hint ar-described" role="status" data-testid="rule-described">
          {notes.join(' ')}
        </p>
      ) : null}
    </DrawerSection>
  )
}
