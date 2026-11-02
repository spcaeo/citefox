import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { AlertDryRunResult, AlertRule, AlertRuleInput } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { MarketChips, ScopeChooser, type Scope, type ScopeOptionsState } from '../../scope'
import { alertsHash } from '../../shell/routes'
import {
  ChipInput,
  Confirm,
  createHelpFillSource,
  Drawer,
  DrawerField,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  type HelpFillSource
} from '../../ui'
import { EventList } from './EventList'
import { RuleDescribe } from './RuleDescribe'
import type { RulesClient } from './rulesClient'
import {
  SCOPE_KINDS,
  checkDraft,
  draftFrom,
  dryRunText,
  newDraft,
  suggestedName,
  type RuleDraft
} from './ruleModel'
import { WhenField } from './WhenField'
import './rules.css'

interface DryRunState {
  key: string
  result: AlertDryRunResult | null
  error: string | null
}

/**
 * One alert rule in the 80% drawer (`drawer=alert-rule&rule.id=<id|new>&rule.from=<id>`):
 * When, which pages and markets, where it goes; the rail runs the rule over the last
 * 30 days of stored checks and lists what it would have sent. Footer: the dry run's
 * count, Delete (an existing rule), Save.
 */
export function RuleDrawer({
  projectId,
  ruleId,
  fromId,
  rules,
  slackReady,
  defaultEmails,
  scope,
  client,
  query,
  onQuery,
  onSaved,
  onDeleted,
  onClose,
  helpSource
}: {
  projectId: string
  /** `new`, or the id of the rule to edit. */
  ruleId: string
  /** Duplicate: the rule to copy into a new one. */
  fromId: string | null
  /** Null while the list loads. */
  rules: readonly AlertRule[] | null
  slackReady: boolean
  /** New rules start with the addresses of "Email a summary after each check". */
  defaultEmails: readonly string[]
  scope: ScopeOptionsState
  client: RulesClient
  query: string
  onQuery: (query: string) => void
  onSaved: (rule: AlertRule, created: boolean) => void
  onDeleted: (rule: AlertRule) => void
  onClose: () => void
  /** Tests only: ✦ Describe it's channels. */
  helpSource?: HelpFillSource
}): JSX.Element {
  const creating = ruleId === 'new'
  const help = useMemo(() => helpSource ?? createHelpFillSource(), [helpSource])
  // ✦ Describe it may only send to addresses already set up here.
  const knownEmails = useMemo(
    () => [...new Set([...defaultEmails, ...(rules ?? []).flatMap((rule) => rule.emailTo)])],
    [defaultEmails, rules]
  )
  const editing = creating ? null : (rules?.find((rule) => rule.id === ruleId) ?? null)
  const source = fromId === null ? null : (rules?.find((rule) => rule.id === fromId) ?? null)
  const missing = rules !== null && !creating && editing === null
  const start = useMemo<RuleDraft | null>(() => {
    if (rules === null) return null
    if (editing) return draftFrom(editing)
    if (source) return draftFrom(source, true)
    return newDraft({ emailTo: defaultEmails })
  }, [rules, editing, source, defaultEmails])
  const [draft, setDraft] = useState<RuleDraft | null>(start)
  const [seenStart, setSeenStart] = useState(start)
  if (start !== seenStart && (draft === null || seenStart === null)) {
    setSeenStart(start)
    setDraft(start)
  }
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dry, setDry] = useState<DryRunState | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const options = scope.options
  const fallbackName = draft ? suggestedName(draft, options) : ''
  const checked = draft ? checkDraft(draft, fallbackName) : null
  const input: AlertRuleInput | null = checked?.input ?? null
  const dryKey = input === null ? '' : JSON.stringify(input)
  const dirty = draft !== null && start !== null && touched

  useEffect(() => {
    if (input === null) return
    let live = true
    const timer = setTimeout(() => {
      client.dryRun(projectId, input).then(
        (result) => {
          if (live) setDry({ key: dryKey, result, error: null })
        },
        (error: unknown) => {
          if (live) {
            setDry({ key: dryKey, result: null, error: errorText(error, 'The dry run failed.') })
          }
        }
      )
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `input` is rebuilt every render; `dryKey` is its stable form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, dryKey])

  function patch(next: Partial<RuleDraft>): void {
    setTouched(true)
    setDraft((current) => (current === null ? current : { ...current, ...next }))
  }

  async function save(): Promise<void> {
    if (input === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await client.save({
        projectId,
        id: editing?.id ?? null,
        ...input
      })
      setSaving(false)
      setTouched(false)
      onSaved(saved, editing === null)
    } catch (error) {
      setSaving(false)
      setSaveError(errorText(error, 'The rule was not saved.'))
    }
  }

  async function remove(): Promise<void> {
    if (editing === null) return
    setSaving(true)
    try {
      await client.remove(projectId, [editing.id])
      setSaving(false)
      setConfirmDelete(false)
      onDeleted(editing)
    } catch (error) {
      setSaving(false)
      setConfirmDelete(false)
      setSaveError(errorText(error, 'The rule was not deleted.'))
    }
  }

  const title = creating ? (source ? 'Duplicate alert rule' : 'New alert rule') : 'Edit alert rule'
  const current = dry !== null && dry.key === dryKey ? dry : null
  const dryLine =
    input === null
      ? 'Fix the fields marked in red to see the dry run'
      : current === null
        ? 'Checking the last 30 days of stored checks…'
        : current.error !== null
          ? current.error
          : dryRunText(current.result?.fired ?? 0, current.result?.days ?? 30)
  const markets = options?.markets ?? []

  return (
    <Drawer
      id="alert-rule"
      title={title}
      subtitle="What to watch, where, and who hears."
      testId="alert-rule-drawer"
      initialFocus={nameRef}
      loading={rules === null || (draft === null && !missing)}
      error={
        missing
          ? { message: 'This alert rule is not available to you. It may have been deleted.' }
          : undefined
      }
      dirty={dirty && !saving}
      guard={{ title: 'Discard this rule?', body: 'Your changes to the rule are not saved.' }}
      closeDisabled={saving}
      busy={saving}
      onClose={onClose}
      footer={{
        summary: (
          <span data-testid="rule-dry-summary">
            <strong>{dryLine}</strong>
            {saveError ? (
              <span className="ar-save-error" role="alert">
                {' '}
                {saveError}
              </span>
            ) : null}
          </span>
        ),
        ...(editing
          ? {
              danger: {
                label: 'Delete rule',
                icon: 'trash',
                disabled: saving,
                onClick: () => setConfirmDelete(true)
              }
            }
          : {}),
        primary: {
          label: creating ? 'Save rule' : 'Save changes',
          disabled: input === null || saving,
          busy: saving,
          onClick: () => void save(),
          testId: 'rule-save'
        }
      }}
    >
      {draft !== null && checked !== null ? (
        <DrawerGrid>
          <DrawerMain>
            {creating ? (
              <RuleDescribe
                projectId={projectId}
                source={help}
                options={options}
                emails={knownEmails}
                slackReady={slackReady}
                disabled={saving}
                onFill={patch}
              />
            ) : null}
            <DrawerSection
              title="When"
              description="One change per rule. It fires once per page, market and check."
            >
              <WhenField
                draft={draft}
                onDraft={patch}
                {...(checked.issues.score ? { scoreError: checked.issues.score } : {})}
                {...(checked.issues.competitor
                  ? { competitorError: checked.issues.competitor }
                  : {})}
              />
            </DrawerSection>
            <DrawerSection
              title="Which pages"
              description="Groups and clusters are read at each check, so pages added later are watched too."
              loading={options === null && scope.error === null}
              error={scope.error}
              onRetry={scope.reload}
            >
              {options ? (
                <div className="ar-scope">
                  <ScopeChooser
                    options={options}
                    value={draft.scope as Scope}
                    onChange={(next) =>
                      patch({
                        scope: {
                          kind: next.kind as RuleDraft['scope']['kind'],
                          ids: next.ids
                        }
                      })
                    }
                    kinds={SCOPE_KINDS}
                    legend="Which pages"
                    pageFilter={(page) => page.tracked}
                    query={query}
                    onQueryChange={onQuery}
                    testId="rule-scope"
                  />
                  {checked.issues.scope ? (
                    <p className="ui-drawer-error" role="alert">
                      {checked.issues.scope}
                    </p>
                  ) : null}
                  {markets.length > 1 ? (
                    <div className="ar-markets">
                      <span className="ui-drawer-label">Markets</span>
                      <MarketChips
                        markets={markets}
                        selected={draft.marketIds}
                        onChange={(ids) => patch({ marketIds: ids })}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DrawerSection>
            <DrawerSection title="Send to" description="Every address gets its own copy.">
              <div className="ar-send">
                <label className="ar-check">
                  <input
                    type="checkbox"
                    checked={draft.desktop}
                    onChange={() => patch({ desktop: !draft.desktop })}
                  />
                  <span>Desktop notification</span>
                </label>
                <DrawerField
                  label="Email"
                  hint="Press Enter or a comma after each address."
                  error={checked.issues.email ?? null}
                >
                  {(ids) => (
                    <ChipInput
                      id={ids.id}
                      items={draft.emailTo}
                      onItems={(items) => patch({ emailTo: items })}
                      draft={draft.emailDraft}
                      onDraft={(text) => patch({ emailDraft: text })}
                      placeholder="name@example.com"
                      {...(ids.describedBy ? { describedBy: ids.describedBy } : {})}
                    />
                  )}
                </DrawerField>
                <label className="ar-check">
                  <input
                    type="checkbox"
                    checked={draft.slack}
                    onChange={() => patch({ slack: !draft.slack })}
                  />
                  <span>Slack</span>
                  <span className="hint">
                    {slackReady ? (
                      'Posts to the webhook saved in Notifications.'
                    ) : (
                      <>
                        No webhook yet: add one in{' '}
                        <a href={alertsHash('notifications')}>Notifications</a>.
                      </>
                    )}
                  </span>
                </label>
                {checked.issues.sendTo ? (
                  <p className="ui-drawer-error" role="alert">
                    {checked.issues.sendTo}
                  </p>
                ) : null}
                <fieldset className="sc-chips ar-delivery">
                  <legend className="ui-drawer-label">How often</legend>
                  <label className="sc-kind">
                    <input
                      type="radio"
                      name="ar-delivery"
                      checked={draft.delivery === 'instant'}
                      onChange={() => patch({ delivery: 'instant' })}
                    />
                    <span>Right after the check</span>
                  </label>
                  <label className="sc-kind">
                    <input
                      type="radio"
                      name="ar-delivery"
                      checked={draft.delivery === 'digest'}
                      onChange={() => patch({ delivery: 'digest' })}
                    />
                    <span>One daily digest</span>
                  </label>
                </fieldset>
              </div>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="Rule name and dry run">
            <DrawerSection title="Name">
              <DrawerField
                label="Rule name"
                hint={draft.name.trim() ? undefined : `Blank uses “${fallbackName}”.`}
                error={checked.issues.name ?? null}
              >
                {(ids) => (
                  <input
                    ref={nameRef}
                    id={ids.id}
                    className="ob-input"
                    value={draft.name}
                    placeholder={fallbackName}
                    aria-describedby={ids.describedBy}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                )}
              </DrawerField>
            </DrawerSection>
            <DrawerSection
              title="Last 30 days"
              count={current?.result ? current.result.fired : undefined}
              description="This rule, run over the checks CiteFox already stored. Nothing is sent."
              loading={input !== null && current === null}
              error={current?.error ?? null}
              testId="rule-dry-run"
              className="ar-dry"
            >
              {input === null ? (
                <p className="hint">Fix the fields marked in red first.</p>
              ) : (
                <EventList
                  events={current?.result?.events ?? []}
                  markets={markets}
                  site={options?.domain ?? null}
                  empty="No check in the last 30 days would have fired this rule."
                  testId="rule-dry-events"
                />
              )}
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
      {confirmDelete && editing ? (
        <Confirm
          title="Delete this alert rule?"
          body={`“${editing.name}” stops firing. Alerts it already sent stay in the Alert log.`}
          confirmLabel="Delete rule"
          busy={saving}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </Drawer>
  )
}
