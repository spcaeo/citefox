import { useState, type JSX } from 'react'
import type { TestSlackResult } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { describedBy } from '../../onboarding/copy'
import { FieldError } from '../../onboarding/parts'
import { sectionHash } from '../../shell/routes'
import { Button, ChipInput } from '../../ui'
import { addChips } from '../../ui/chipList'
import { Switch } from '../bits'
import type { AlertUpdate, AlertView, EmailView } from '../client'
import { emailChipsIssue, emailListIssue } from '../model'
import { useServerDraft } from '../useServerDraft'

/**
 * FR-23.13 notifications for the open project: desktop, email (every address in
 * the chips gets the summary), Slack with a test message, and the monthly PDF.
 */
export function NotificationsSection({
  alerts,
  email,
  onPatch,
  onTestSlack
}: {
  alerts: AlertView
  email: EmailView | null
  onPatch: (patch: AlertUpdate) => Promise<AlertView | null>
  /** Posts one test message to the typed webhook, or the saved one. Never retried. */
  onTestSlack?: (webhook?: string) => Promise<TestSlackResult>
}): JSX.Element {
  const savedEmails = alerts.emailTo.join('\n')
  const [emailText, setEmailText] = useServerDraft(savedEmails)
  const emailItems = emailText.length === 0 ? [] : emailText.split('\n')
  const [emailDraft, setEmailDraft] = useState('')
  const [pdfTo, setPdfTo] = useServerDraft(alerts.monthlyPdfTo)
  const [slackUrl, setSlackUrl] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [slackTest, setSlackTest] = useState<TestSlackResult | null>(null)
  const [slackTesting, setSlackTesting] = useState(false)

  function saveEmails(items: readonly string[]): void {
    setEmailText(items.join('\n'))
    const issue = emailChipsIssue(items)
    setEmailError(issue)
    if (!issue && items.join('\n') !== savedEmails) {
      void onPatch({ projectId: alerts.projectId, emailTo: [...items] })
    }
  }

  async function testSlack(): Promise<void> {
    if (!onTestSlack) return
    const typed = slackUrl.trim()
    setSlackTesting(true)
    try {
      setSlackTest(await (typed.length > 0 ? onTestSlack(typed) : onTestSlack()))
    } catch (cause) {
      setSlackTest({
        ok: false,
        testedAt: new Date().toISOString(),
        message: errorText(cause, 'The test message was not sent.')
      })
    } finally {
      setSlackTesting(false)
    }
  }

  return (
    <section id="notifications" className="card page-card" aria-labelledby="notifications-h">
      <h2 id="notifications-h">Notifications</h2>
      <div>
        <div className="switch-row">
          <span id="sw-desk-l" className="switch-label">
            Desktop notification when a check finishes or a page gains or loses a citation
          </span>
          <Switch
            labelledBy="sw-desk-l"
            on={alerts.desktop}
            onToggle={() => void onPatch({ projectId: alerts.projectId, desktop: !alerts.desktop })}
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-email-l" className="switch-label">
              Email a summary after each check
            </span>
            {alerts.emailAfterCheck ? (
              <span className="field">
                <label htmlFor="n-email" className="hint">
                  Email to
                </label>
                <span
                  className="nt-chips"
                  data-testid="n-email-chips"
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                    if (emailDraft.trim().length === 0) {
                      saveEmails(emailItems)
                      return
                    }
                    const next = addChips(emailItems, emailDraft)
                    setEmailDraft('')
                    saveEmails(next)
                  }}
                >
                  <ChipInput
                    id="n-email"
                    items={emailItems}
                    onItems={(items) => saveEmails(items)}
                    draft={emailDraft}
                    onDraft={setEmailDraft}
                    placeholder="name@example.com"
                    describedBy={describedBy([
                      'n-email-hint',
                      emailError ? 'n-email-error' : false
                    ])}
                  />
                </span>
                <span className="hint" id="n-email-hint">
                  Press Enter or a comma after each address. Every address gets its own copy.
                </span>
                {emailError ? <FieldError id="n-email-error">{emailError}</FieldError> : null}
                <label className="field-label" htmlFor="n-account">
                  Sending account
                </label>
                <select
                  id="n-account"
                  className="select"
                  value={alerts.emailAccountId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    void onPatch({
                      projectId: alerts.projectId,
                      emailAccountId: value.length > 0 ? value : null
                    })
                  }}
                >
                  <option value="">Default sending account</option>
                  {(email?.accounts ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.fromAddress}
                    </option>
                  ))}
                </select>
              </span>
            ) : null}
          </span>
          <Switch
            labelledBy="sw-email-l"
            on={alerts.emailAfterCheck}
            onToggle={() =>
              void onPatch({
                projectId: alerts.projectId,
                emailAfterCheck: !alerts.emailAfterCheck
              })
            }
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-slack-l" className="switch-label">
              Post to Slack
            </span>
            {alerts.slackEnabled ? (
              <span className="field">
                <label htmlFor="n-slack" className="hint">
                  Slack webhook URL
                </label>
                <input
                  id="n-slack"
                  className="ob-input mono"
                  type="url"
                  placeholder="https://hooks.slack.com/services/…"
                  value={slackUrl}
                  autoComplete="off"
                  aria-describedby="n-slack-hint"
                  onChange={(event) => setSlackUrl(event.target.value)}
                  onBlur={() => {
                    const value = slackUrl.trim()
                    if (value.length === 0) return
                    void onPatch({ projectId: alerts.projectId, slackWebhook: value }).then(
                      (saved) => {
                        if (saved) setSlackUrl('')
                      }
                    )
                  }}
                />
                <span className="hint" id="n-slack-hint">
                  {alerts.slackWebhookStored
                    ? 'Saved in your system keychain. Leave blank to keep it.'
                    : 'Saved in your system keychain. CiteFox never shows it again.'}
                </span>
                {onTestSlack ? (
                  <span className="nt-slack-test">
                    <Button
                      size="sm"
                      busy={slackTesting}
                      disabled={
                        slackTesting || (!alerts.slackWebhookStored && slackUrl.trim().length === 0)
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void testSlack()}
                      data-testid="slack-test"
                    >
                      Send a test message
                    </Button>
                    {slackTest ? (
                      <span
                        className={
                          slackTest.ok ? 'result ok nt-slack-result' : 'result fail nt-slack-result'
                        }
                        role="status"
                        data-testid="slack-test-result"
                      >
                        {slackTest.message}
                      </span>
                    ) : !alerts.slackWebhookStored && slackUrl.trim().length === 0 ? (
                      <span className="hint">Paste a webhook URL to test it.</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
          <Switch
            labelledBy="sw-slack-l"
            on={alerts.slackEnabled}
            onToggle={() =>
              void onPatch({ projectId: alerts.projectId, slackEnabled: !alerts.slackEnabled })
            }
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-report-l" className="switch-label">
              Send a client report: monthly PDF to a client contact
            </span>
            <span className="hint">
              Uses the layout and sections you set in <a href={sectionHash('export')}>Export</a>.
              Sent on the 1st of each month.
            </span>
            {alerts.monthlyClientPdf ? (
              <span className="field">
                <label htmlFor="n-report" className="hint">
                  Send the PDF to
                </label>
                <input
                  id="n-report"
                  className="ob-input"
                  type="email"
                  placeholder="client@example.com"
                  value={pdfTo}
                  aria-invalid={pdfError ? true : undefined}
                  aria-describedby={describedBy([
                    'n-report-hint',
                    pdfError ? 'n-report-error' : false
                  ])}
                  onChange={(event) => setPdfTo(event.target.value)}
                  onBlur={() => {
                    const issue = pdfTo.trim().length === 0 ? null : emailListIssue(pdfTo)
                    setPdfError(issue)
                    if (!issue) {
                      void onPatch({ projectId: alerts.projectId, monthlyPdfTo: pdfTo.trim() })
                    }
                  }}
                />
                <span className="hint" id="n-report-hint">
                  The monthly PDF address is kept with this project&apos;s alerts.
                </span>
                {pdfError ? <FieldError id="n-report-error">{pdfError}</FieldError> : null}
              </span>
            ) : null}
          </span>
          <Switch
            labelledBy="sw-report-l"
            on={alerts.monthlyClientPdf}
            onToggle={() =>
              void onPatch({
                projectId: alerts.projectId,
                monthlyClientPdf: !alerts.monthlyClientPdf
              })
            }
          />
        </div>
      </div>
    </section>
  )
}
