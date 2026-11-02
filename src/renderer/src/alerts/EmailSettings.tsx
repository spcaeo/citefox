import { useRef, useState, type JSX } from 'react'
import type { EmailMode, EmailTestResult } from '@shared/domain'
import { Icon } from '../components/Icon'
import { describedBy } from '../onboarding/copy'
import { FieldError } from '../onboarding/parts'
import { Button, Confirm, Panel, SecretField } from '../ui'
import type { AlertsClient, EmailView } from './client'
import { AccountSection } from './email/AccountSection'
import { focusIssue } from './email/focusIssue'
import { ProviderGuideBlock, TextField } from './email/parts'
import {
  DRAFT_MODE_NOTE,
  UNENCRYPTED_MAIL_WARNING,
  accountIssues,
  connectionSubtitle,
  draftForProvider,
  draftFromAccount,
  emptyAccountDraft,
  guideFor,
  hasAccountIssues,
  lastTestLabel,
  passwordHint,
  providerGuides,
  securityWarning,
  testRecipientIssue,
  toSaveRequest,
  SECURITY_OPTIONS,
  type AccountDraft,
  type AccountIssues,
  type EmailAccountRow
} from './model'

/** `#/settings?tab=email&account=<id>` opens that account. Read here, from the URL. */
function accountFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('account')
}

export function EmailSettings({
  client,
  email,
  timeZone,
  activeProjectId = null,
  onEmail,
  onError
}: {
  client: AlertsClient
  email: EmailView
  timeZone: string
  /** The open project, so its name can link to Project settings. */
  activeProjectId?: string | null
  onEmail: (value: EmailView) => void
  onError: (reason: string | null) => void
}): JSX.Element {
  const [draft, setDraft] = useState<AccountDraft>(() => openingDraft(email))
  const [issues, setIssues] = useState<AccountIssues>({})
  const [showPassword, setShowPassword] = useState(false)
  const [testTo, setTestTo] = useState(openingDraft(email).fromAddress)
  const [testError, setTestError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<EmailAccountRow | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const guide = guideFor(draft.provider)
  const editedAccount = email.accounts.find((account) => account.id === draft.id) ?? null
  const warning = securityWarning(draft.security)

  function replaceAccounts(next: EmailView): void {
    onEmail(next)
    onError(null)
  }

  async function chooseMode(mode: EmailMode): Promise<void> {
    const result = await client.setMode({ mode })
    if (result.value) replaceAccounts(result.value)
    else onError(result.unavailable?.reason ?? null)
  }

  function editAccount(account: EmailAccountRow): void {
    const next = draftFromAccount(account)
    setDraft(next)
    setIssues({})
    setShowPassword(false)
    setTestResult(null)
    setTestTo(account.fromAddress)
    document.getElementById('conn-h')?.scrollIntoView({ block: 'nearest' })
  }

  async function save(): Promise<void> {
    const nextIssues = accountIssues(draft)
    setIssues(nextIssues)
    if (hasAccountIssues(nextIssues)) {
      focusIssue(nextIssues)
      return
    }
    setBusy(true)
    const result = await client.saveAccount(toSaveRequest(draft))
    setBusy(false)
    if (!result.value) {
      onError(result.unavailable?.reason ?? null)
      return
    }
    const accounts = upsertRow(email.accounts, result.value)
    replaceAccounts({ mode: email.mode, accounts })
    setDraft(draftFromAccount(result.value))
    setShowPassword(false)
  }

  async function sendTest(): Promise<void> {
    const issue = testRecipientIssue(testTo)
    setTestError(issue)
    setTestResult(null)
    if (issue) {
      document.getElementById('e-test')?.focus()
      return
    }
    if (draft.id === null) {
      onError('Save the account, then send the test.')
      return
    }
    setBusy(true)
    const result = await client.testAccount({ id: draft.id, to: testTo.trim() })
    setBusy(false)
    if (!result.value) {
      onError(result.unavailable?.reason ?? null)
      return
    }
    onError(null)
    setTestResult(result.value)
    const refreshed = await client.getEmail()
    if (refreshed.value) onEmail(refreshed.value)
  }

  async function confirmRemove(): Promise<void> {
    if (!removing) return
    setBusy(true)
    const result = await client.removeAccount(removing.id)
    setBusy(false)
    if (!result.value) {
      onError(result.unavailable?.reason ?? null)
      return
    }
    const accounts = email.accounts.filter((account) => account.id !== removing.id)
    replaceAccounts({ mode: email.mode, accounts })
    if (draft.id === removing.id) {
      const next = accounts[0] ? draftFromAccount(accounts[0]) : emptyAccountDraft()
      setDraft(next)
      setTestTo(next.fromAddress)
    }
    setRemoving(null)
    returnFocus.current?.focus()
  }

  return (
    <div className="al-email">
      <section className="card page-card" aria-labelledby="mode-h">
        <h2 id="mode-h">How should CiteFox send email?</h2>
        <div className="grid2" role="radiogroup" aria-labelledby="mode-h">
          <label className={email.mode === 'smtp' ? 'radio on' : 'radio'}>
            <input
              type="radio"
              name="mode"
              value="smtp"
              checked={email.mode === 'smtp'}
              onChange={() => void chooseMode('smtp')}
            />
            <span className="choice">
              <span className="inline">
                <strong>Send through SMTP</strong>
                <span className="tag">Recommended for scheduled reports</span>
              </span>
              <span className="hint">
                CiteFox signs in to your mail provider and sends on schedule by itself, while it
                runs in the tray. One-time setup, about 5 minutes.
              </span>
            </span>
          </label>
          <label className={email.mode === 'mail_app' ? 'radio on' : 'radio'}>
            <input
              type="radio"
              name="mode"
              value="mail_app"
              checked={email.mode === 'mail_app'}
              onChange={() => void chooseMode('mail_app')}
            />
            <span className="choice">
              <strong>Open a draft in my mail app</strong>
              <span className="hint">
                No setup. CiteFox opens a new message with the report attached and you press Send
                yourself. Scheduled reports can&apos;t go out while you&apos;re away.
              </span>
            </span>
          </label>
        </div>
        {email.mode === 'mail_app' ? (
          <div className="note">
            <Icon name="info" />
            <p className="muted">{DRAFT_MODE_NOTE}</p>
          </div>
        ) : null}
      </section>

      {email.mode === 'smtp' ? (
        <AccountSection
          accounts={email.accounts}
          timeZone={timeZone}
          activeProjectId={activeProjectId}
          onEdit={editAccount}
          onTest={(account) => {
            editAccount(account)
            requestAnimationFrame(() => document.getElementById('e-test')?.focus())
          }}
          onRemove={(account, button) => {
            returnFocus.current = button
            setRemoving(account)
          }}
          onAdd={() => {
            setDraft(emptyAccountDraft('gmail'))
            setIssues({})
            setShowPassword(false)
            setTestResult(null)
            document.getElementById('prov-h')?.focus()
          }}
        />
      ) : null}

      <div className="al-grid al-grid-flush">
        <div className="al-main">
          {email.mode === 'smtp' ? (
            <>
              <section className="card page-card" aria-labelledby="prov-h">
                <div>
                  <h2 id="prov-h">Email provider</h2>
                  <p className="faint">
                    Pick yours and CiteFox fills in the server settings below.
                  </p>
                </div>
                <div className="prov-grid" role="group" aria-label="Email provider">
                  {providerGuides().map((item) => (
                    <button
                      key={item.provider}
                      type="button"
                      className="prov"
                      aria-pressed={draft.provider === item.provider}
                      onClick={() => {
                        setDraft(draftForProvider(item.provider, draft))
                        setIssues({})
                        setShowPassword(false)
                        setTestResult(null)
                      }}
                    >
                      <strong>{item.name}</strong>
                      <span className="hint">{item.sub}</span>
                    </button>
                  ))}
                </div>
                <ProviderGuideBlock guide={guide} />
              </section>

              {/* A real form so the username and app password pair up (owner password rule);
                  Save and Send test stay plain buttons, so Enter does nothing new. */}
              <form
                className="card page-card"
                aria-labelledby="conn-h"
                onSubmit={(event) => event.preventDefault()}
              >
                <div>
                  <h2 id="conn-h">Connection</h2>
                  <p className="faint">{connectionSubtitle(draft)}</p>
                </div>
                <div className="grid3">
                  <TextField
                    id="e-from-name"
                    label="From name"
                    value={draft.fromName}
                    error={issues.fromName}
                    onChange={(fromName) => setDraft({ ...draft, fromName })}
                  />
                  <TextField
                    id="e-from"
                    label="From address"
                    type="email"
                    mono
                    value={draft.fromAddress}
                    error={issues.fromAddress}
                    onChange={(fromAddress) => setDraft({ ...draft, fromAddress })}
                  />
                  <TextField
                    id="e-reply"
                    label="Reply-to"
                    optional
                    type="email"
                    mono
                    placeholder="ops@example.com"
                    value={draft.replyTo}
                    error={issues.replyTo}
                    onChange={(replyTo) => setDraft({ ...draft, replyTo })}
                  />
                </div>
                <div className="server">
                  <div className="field span-2">
                    <label className="field-label" htmlFor="e-host">
                      SMTP host
                    </label>
                    <input
                      id="e-host"
                      className="ob-input mono"
                      type="text"
                      placeholder="smtp.example.com"
                      spellCheck={false}
                      value={draft.host}
                      aria-invalid={issues.host ? true : undefined}
                      aria-describedby={describedBy([
                        guide.hostHint ? 'e-host-hint' : false,
                        issues.host ? 'e-host-error' : false
                      ])}
                      onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                    />
                    {guide.hostHint ? (
                      <span className="hint" id="e-host-hint">
                        {guide.hostHint}
                      </span>
                    ) : null}
                    {issues.host ? <FieldError id="e-host-error">{issues.host}</FieldError> : null}
                  </div>
                  <TextField
                    id="e-port"
                    label="Port"
                    mono
                    inputMode="numeric"
                    placeholder="587"
                    value={draft.port}
                    error={issues.port}
                    onChange={(port) => setDraft({ ...draft, port })}
                  />
                  <div className="field">
                    <label className="field-label" htmlFor="e-sec">
                      Security
                    </label>
                    <select
                      id="e-sec"
                      className="select"
                      value={draft.security}
                      aria-describedby={warning ? 'e-sec-warn' : undefined}
                      onChange={(event) => {
                        const next = SECURITY_OPTIONS.find(
                          (option) => option.value === event.target.value
                        )
                        if (!next) return
                        setDraft({ ...draft, security: next.value })
                      }}
                    >
                      {SECURITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {warning ? (
                      <p className="hint warn-ink" id="e-sec-warn">
                        {UNENCRYPTED_MAIL_WARNING}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="grid2">
                  <TextField
                    id="e-user"
                    label="Username"
                    mono
                    placeholder={guide.userPlaceholder}
                    hint={guide.userHint}
                    value={draft.username}
                    error={issues.username}
                    spellCheck={false}
                    autoComplete="username"
                    onChange={(username) => setDraft({ ...draft, username })}
                  />
                  <div className="field">
                    <label className="field-label" htmlFor="e-pass">
                      {guide.passLabel}
                    </label>
                    <div className="pw">
                      {/* The mail account's existing app password, entered (not set) here:
                          current-password, no Confirm field. */}
                      <SecretField
                        kind="password"
                        autoComplete="current-password"
                        id="e-pass"
                        shown={showPassword}
                        onShownChange={setShowPassword}
                        className="ob-input mono"
                        placeholder={guide.passPlaceholder}
                        value={draft.password}
                        aria-invalid={issues.password ? true : undefined}
                        aria-describedby={describedBy([
                          'e-pass-hint',
                          issues.password ? 'e-pass-error' : false
                        ])}
                        onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                      />
                    </div>
                    <span className="hint" id="e-pass-hint">
                      {passwordHint(guide, draft.id !== null)}
                    </span>
                    {issues.password ? (
                      <FieldError id="e-pass-error">{issues.password}</FieldError>
                    ) : null}
                  </div>
                </div>
                <div className="field">
                  <label className="switch-label" htmlFor="e-default">
                    <input
                      id="e-default"
                      type="checkbox"
                      checked={draft.isDefault}
                      onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
                    />{' '}
                    Default sending account
                  </label>
                  <span className="hint">
                    The default sends everything unless a project or schedule picks another.
                  </span>
                </div>
                <div className="sub">
                  <div className="inline inline-start">
                    <div className="field">
                      <label className="field-label" htmlFor="e-test">
                        Send a test email to
                      </label>
                      <input
                        id="e-test"
                        className="ob-input mono"
                        type="email"
                        value={testTo}
                        aria-invalid={testError ? true : undefined}
                        aria-describedby={testError ? 'e-test-error' : undefined}
                        onChange={(event) => setTestTo(event.target.value)}
                      />
                      {testError ? <FieldError id="e-test-error">{testError}</FieldError> : null}
                    </div>
                    <Button disabled={busy} onClick={() => void sendTest()}>
                      Send test
                    </Button>
                  </div>
                  {!testResult && editedAccount ? (
                    <p className="hint" id="e-last-test" role="status">
                      <span className="faint">Last test: </span>
                      {lastTestLabel(editedAccount, timeZone)}
                      {editedAccount.lastTestMessage ? ` · ${editedAccount.lastTestMessage}` : ''}
                      {editedAccount.lastTestNextStep ? ` ${editedAccount.lastTestNextStep}` : ''}
                    </p>
                  ) : null}
                  {testResult?.ok ? (
                    <div className="result ok" role="status">
                      <Icon name="check" />
                      <p>
                        <span className="st st-ok">Test sent to {testTo.trim()}</span> · delivered
                        by <span className="mono">{testResult.host}</span>
                      </p>
                    </div>
                  ) : null}
                  {testResult && !testResult.ok ? (
                    <div className="result fail" role="alert">
                      <Icon name="warning" />
                      <div className="stack-tight">
                        <p>{testResult.message}</p>
                        {testResult.nextStep ? <p className="hint">{testResult.nextStep}</p> : null}
                        <p className="hint">
                          Nothing was sent. Change the setting above, then send the test again.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="inline inline-start">
                  <Button variant="primary" disabled={busy} onClick={() => void save()}>
                    Save account
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const next = emptyAccountDraft(draft.provider)
                      setDraft({
                        ...next,
                        fromName: draft.fromName,
                        fromAddress: draft.fromAddress,
                        replyTo: draft.replyTo
                      })
                      setIssues({})
                      setShowPassword(false)
                      setTestResult(null)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </>
          ) : null}
        </div>
        <div className="al-rail">
          <Panel title="Deliverability tips" titleAs="h3" tone="inset" padding={20}>
            <p className="hint">So reports land in the inbox, not spam.</p>
            <ul className="tips">
              <li>
                <strong>Send from your own domain.</strong> An address at your own domain is trusted
                more than a free mail address, especially by clients&apos; mail servers.
              </li>
              <li>
                <strong>SPF:</strong> a DNS record that lists which services may send mail for your
                domain. Add your provider to it.
              </li>
              <li>
                <strong>DKIM:</strong> a signing key your provider gives you; publish it in DNS so
                receivers can tell the message wasn&apos;t changed.
              </li>
              <li>
                <strong>DMARC:</strong> a DNS record that tells receivers what to do when SPF or
                DKIM fail. Start with <span className="mono">p=none</span> and tighten it later.
              </li>
              <li>
                <strong>Keep reports small.</strong> Attach the PDF when it&apos;s under 10 MB; for
                anything bigger, send a link to the HTML report instead.
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      {removing ? (
        <Confirm
          title="Remove this sending account?"
          body={`${removing.fromAddress} will no longer send reports or alerts. The password is removed from your system keychain.`}
          confirmLabel="Remove account"
          busy={busy}
          onCancel={() => {
            setRemoving(null)
            returnFocus.current?.focus()
          }}
          onConfirm={() => void confirmRemove()}
        />
      ) : null}
    </div>
  )
}

function openingDraft(email: EmailView): AccountDraft {
  const asked = accountFromHash()
  const current =
    (asked ? email.accounts.find((account) => account.id === asked) : undefined) ??
    email.accounts.find((account) => account.isDefault) ??
    email.accounts[0]
  return current ? draftFromAccount(current) : emptyAccountDraft()
}

function upsertRow(accounts: readonly EmailAccountRow[], row: EmailAccountRow): EmailAccountRow[] {
  const cleared = row.isDefault
    ? accounts.map((account) =>
        account.id === row.id ? account : { ...account, isDefault: false }
      )
    : [...accounts]
  const index = cleared.findIndex((account) => account.id === row.id)
  if (index >= 0) {
    const next = [...cleared]
    next[index] = row
    return next
  }
  return [row, ...cleared]
}
