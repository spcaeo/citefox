import { useState, type JSX } from 'react'
import { DIAGNOSTICS_EMAIL, DIAGNOSTICS_NOTE_MAX } from '@shared/ipc'
import { reportIssueUrl } from '@shared/problem-report'
import { copyText } from '../components/clipboard'
import { errorText } from '../components/errorText'
import {
  Button,
  CopyText,
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  showUndo
} from '../ui'
import { useCopyFeedback } from '../ui/useCopyFeedback'
import { diagnosticsClient, type DiagnosticsClient } from './client'
import { REPORT_DRAWER } from './actions'
import { useReport } from './useReport'
import './diagnostics.css'

export interface ReportProblemDrawerProps {
  /** "Include my question texts" (`rp.q=1`). Off by default. */
  includeQuestions: boolean
  onIncludeQuestions: (value: boolean) => void
  /** The project the failed checks come from (`rp.project`), or null for every project. */
  projectId: string | null
  onClose: () => void
  client?: DiagnosticsClient
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
}

/**
 * Report a problem (`?drawer=report-problem`): the exact text that would be shared, a note
 * of what happened, and five ways to hand it over. CiteFox sends nothing by itself: Send to
 * CiteFox needs a tick on the consent line and a click. Email and GitHub carry only a short
 * message, so the full report is copied first and the person pastes it.
 */
export function ReportProblemDrawer({
  includeQuestions,
  onIncludeQuestions,
  projectId,
  onClose,
  client = diagnosticsClient()
}: ReportProblemDrawerProps): JSX.Element {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'send' | 'save' | 'mail' | 'issue' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  /** The reference once the report reached the CiteFox team. */
  const [sentId, setSentId] = useState<string | null>(null)
  /** A send that did not go through: Save as file and Email are the way out. */
  const [sendFailed, setSendFailed] = useState(false)
  const state = useReport(client, { includeQuestions, note, projectId })
  const text = state.report?.text ?? ''
  const copy = useCopyFeedback(text)
  const ready = state.report !== null && !state.refreshing

  /** Copies the whole report, then says to paste it. False when the copy did not work. */
  async function copyForPaste(where: string): Promise<boolean> {
    const copied = await copyText(text)
    showUndo(
      copied
        ? { message: 'The full report is copied.', effect: `Paste it into ${where}.` }
        : {
            message: 'CiteFox could not copy the report.',
            effect: 'Select the text in the box, copy it, then paste it.'
          }
    )
    return copied
  }

  async function send(): Promise<void> {
    setBusy('send')
    setMessage(null)
    setSendFailed(false)
    try {
      const result = await client.send({
        includeQuestions,
        note,
        projectId,
        consent: true,
        text
      })
      if (result.ok) setSentId(result.reportId)
      else setSendFailed(true)
    } catch {
      setSendFailed(true)
    } finally {
      setBusy(null)
    }
  }

  async function save(): Promise<void> {
    setBusy('save')
    setMessage(null)
    try {
      const result = await client.save(text)
      if (result.saved)
        showUndo({ message: `Saved ${result.filename}.`, effect: 'Nothing was sent.' })
    } catch (cause) {
      setMessage(errorText(cause, 'Could not save the file.'))
    } finally {
      setBusy(null)
    }
  }

  async function email(): Promise<void> {
    setBusy('mail')
    setMessage(null)
    try {
      await copyForPaste('the email')
      const result = await client.openMail(note)
      if (!result.ok) setMessage(`${result.reason} ${result.nextStep}`)
    } catch (cause) {
      setMessage(errorText(cause, 'Could not open your mail program.'))
    } finally {
      setBusy(null)
    }
  }

  async function issue(): Promise<void> {
    setBusy('issue')
    setMessage(null)
    try {
      await copyForPaste('the GitHub issue')
      window.open(
        reportIssueUrl(state.report?.release ?? '', note),
        '_blank',
        'noopener,noreferrer'
      )
    } finally {
      setBusy(null)
    }
  }

  async function showLogs(): Promise<void> {
    try {
      const result = await client.revealLogs()
      if (!result.ok) setMessage(`${result.reason} ${result.nextStep}`)
    } catch (cause) {
      setMessage(errorText(cause, 'Could not open the logs folder.'))
    }
  }

  return (
    <Drawer
      id={REPORT_DRAWER}
      title="Report a problem"
      subtitle="Nothing is sent unless you choose it below. This is exactly what would be shared."
      testId="report-problem-drawer"
      loading={state.loading}
      busy={busy !== null}
      closeDisabled={busy !== null}
      onClose={onClose}
      {...(state.error ? { error: { message: state.error, onRetry: state.reload } } : {})}
      footer={{
        summary: (
          <label className="rp-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={sentId !== null}
              onChange={(event) => setConsent(event.target.checked)}
              data-testid="report-consent"
            />
            <span>
              I understand this report (shown above) is sent to the CiteFox team at Space-O
              Technologies.
            </span>
          </label>
        ),
        secondary: {
          label: copy.state === 'copied' ? 'Copied' : 'Copy report',
          icon: copy.state === 'copied' ? 'check' : 'copy',
          disabled: !ready,
          onClick: copy.copy,
          testId: 'report-copy'
        },
        primary: {
          label: sentId !== null ? 'Sent' : 'Send to CiteFox',
          icon: sentId !== null ? 'check' : undefined,
          busy: busy === 'send',
          disabled: !ready || !consent || busy !== null || sentId !== null,
          onClick: () => void send(),
          testId: 'report-send'
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          {sentId !== null ? (
            <p className="rp-sent" role="status" data-testid="report-sent">
              Sent. Your reference is <CopyText text={sentId} />. Please quote it if you write to
              us.
            </p>
          ) : null}
          {sendFailed ? (
            <p className="rp-failed" role="alert" data-testid="report-send-failed">
              We could not send it just now. Your report is still here: save it as a file, or email
              it to {DIAGNOSTICS_EMAIL}.
            </p>
          ) : null}
          {message ? (
            <p className="rp-failed" role="alert">
              {message}
            </p>
          ) : null}
          <DrawerSection
            title="What happened?"
            description="Optional. A sentence or two helps us a lot."
          >
            <textarea
              className="ui-input rp-note"
              rows={3}
              value={note}
              maxLength={DIAGNOSTICS_NOTE_MAX}
              aria-label="What happened?"
              placeholder="For example: most of my questions say “Check failed”."
              data-autofocus=""
              onChange={(event) => setNote(event.target.value)}
            />
            <label className="rp-check">
              <input
                type="checkbox"
                checked={includeQuestions}
                onChange={(event) => onIncludeQuestions(event.target.checked)}
              />
              <span>
                Include my question texts
                <span className="rp-hint">
                  Off: failed checks show the reason only, never what you asked.
                </span>
              </span>
            </label>
          </DrawerSection>
          <DrawerSection
            title="The report"
            description={`Keys, email addresses, your home folder and IP addresses are removed.${
              state.report
                ? ` ${state.report.lines.toLocaleString()} lines · ${sizeLabel(state.report.bytes)}.`
                : ''
            }`}
          >
            <pre
              className="rp-preview"
              tabIndex={0}
              role="region"
              aria-label="Report preview"
              aria-busy={state.refreshing}
              data-testid="report-preview"
            >
              {text}
            </pre>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="Other ways to share">
          <DrawerSection
            title="Other ways to share"
            description="Email and GitHub open with a short message. The full report is copied for you to paste."
          >
            <div className="rp-actions">
              <Button
                variant={sendFailed ? 'primary' : 'secondary'}
                disabled={!ready || busy !== null}
                busy={busy === 'save'}
                onClick={() => void save()}
                data-testid="report-save"
              >
                Save as file…
              </Button>
              <Button
                variant={sendFailed ? 'primary' : 'secondary'}
                disabled={!ready || busy !== null}
                busy={busy === 'mail'}
                onClick={() => void email()}
                data-testid="report-email"
              >
                Email it to us
              </Button>
              <Button
                variant="secondary"
                disabled={!ready || busy !== null}
                busy={busy === 'issue'}
                onClick={() => void issue()}
                data-testid="report-issue"
              >
                Open a GitHub issue
              </Button>
            </div>
            <p className="rp-hint">A GitHub issue is public. Email is private.</p>
          </DrawerSection>
          <DrawerSection title="Log files">
            <Button variant="text" onClick={() => void showLogs()} data-testid="report-logs">
              Show logs folder
            </Button>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
