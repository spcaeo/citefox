import { useState, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { Button, ChipInput, DrawerField, DrawerFields, DrawerSection } from '../../../../ui'
import { addChips, LIST_SEPARATORS } from '../../../../ui/chipList'
import { emailProblem, type AccountOption, type ScheduleDraft } from '../../../scheduleModel'

/**
 * Who: the recipients as chips (paste "a@x.com, b@y.com; c@z.com" or one per
 * line; each is checked), the sending account, and the subject line.
 */
export function WhoSection({
  draft,
  patch,
  accounts
}: {
  draft: ScheduleDraft
  patch: (partial: Partial<ScheduleDraft>) => void
  accounts: readonly AccountOption[]
}): JSX.Element {
  const [typed, setTyped] = useState('')
  const bad = draft.recipients.filter((address) => emailProblem(address) !== null)
  const add = (): void => {
    if (!typed.trim()) return
    patch({ recipients: addChips(draft.recipients, typed, LIST_SEPARATORS) })
    setTyped('')
  }
  return (
    <DrawerSection
      title="Who"
      count={draft.recipients.length > 0 ? draft.recipients.length : undefined}
      description="Who gets it and who it comes from."
      testId="sd-who"
    >
      <DrawerFields columns={2}>
        <DrawerField
          label="Recipients"
          htmlFor="n-rcpt"
          wide
          hint="Paste many at once: separate them with commas, semicolons or new lines."
          error={
            bad.length === 0
              ? null
              : `${pluralize(bad.length, 'address', 'addresses')} ${bad.length === 1 ? 'is' : 'are'} not valid: ${bad.join(', ')}. Fix or remove ${bad.length === 1 ? 'it' : 'them'}.`
          }
        >
          {({ id, describedBy }) => (
            <div className="rpt-rcpt-row">
              <ChipInput
                id={id}
                items={draft.recipients}
                onItems={(recipients) => patch({ recipients })}
                draft={typed}
                onDraft={setTyped}
                placeholder="name@example.com, boss@example.com"
                {...(describedBy ? { describedBy } : {})}
                separators={LIST_SEPARATORS}
                invalid={emailProblem}
              />
              <Button onClick={add}>Add</Button>
            </div>
          )}
        </DrawerField>
        <DrawerField label="Send from" htmlFor="n-from">
          <select
            id="n-from"
            className="ui-input rpt-select"
            value={draft.accountId ?? ''}
            onChange={(event) =>
              patch({ accountId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">Default sender</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
                {account.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </DrawerField>
        <DrawerField
          label="Subject line"
          htmlFor="n-subj"
          hint={
            <>
              Variables: <span className="mono">{'{project} {date_range} {market} {score}'}</span>
            </>
          }
        >
          <input
            id="n-subj"
            className="ui-input mono"
            value={draft.subject}
            onChange={(event) => patch({ subject: event.target.value })}
          />
        </DrawerField>
      </DrawerFields>
    </DrawerSection>
  )
}
