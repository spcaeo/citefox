import { useId, useState, type JSX } from 'react'
import './branding.css'
import { LOGO_MAX } from '@shared/report/review/extras'
import {
  NO_SENDER,
  SENDER_LINK_MAX,
  SENDER_NAME_MAX,
  senderFieldProblem,
  type BrandingMode,
  type ReportSender
} from '@shared/report/review/sender'
import { errorText } from '../../components/errorText'
import { readLogo } from '../../projectSettings/utils/branding'
import { Button, WayList, type WayOption } from '../../ui'
import { useReportSender } from './senderStore'

const MODES: readonly WayOption<BrandingMode>[] = [
  {
    id: 'agency',
    icon: 'layers',
    title: 'An agency, for clients',
    example: 'Your agency’s name and logo, “Prepared for” each client'
  },
  {
    id: 'company',
    icon: 'target',
    title: 'My own company (in-house)',
    example: 'Your company’s name and logo, for your team or leadership'
  },
  {
    id: 'none',
    icon: 'eye',
    title: 'Just me, no branding',
    example: 'Plain reports, no logo'
  }
]

/**
 * "Who are these reports from?" (Settings › Reports, and the drawer from the Reports
 * home): the three-way question first, then only the fields for that answer. App-wide:
 * set once, used for every project. `brand` is the open project's brand, the company
 * name's placeholder (an empty company name reads as each project's brand).
 */
export function BrandingForm({
  brand = '',
  onSaved
}: {
  brand?: string
  onSaved?: (sender: ReportSender) => void
}): JSX.Element {
  const { sender, save } = useReportSender()
  const loaded = sender ?? NO_SENDER
  const [seen, setSeen] = useState<ReportSender | null>(sender)
  const [draft, setDraft] = useState<ReportSender>(loaded)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const base = useId()
  if (seen !== sender) {
    setSeen(sender)
    setDraft(loaded)
  }

  const patch = (part: Partial<ReportSender>): void => {
    setDraft((now) => ({ ...now, ...part }))
    setNote(null)
  }
  const websiteProblem = senderFieldProblem('website', draft.website)
  const emailProblem = senderFieldProblem('email', draft.email)
  const nameMissing = draft.mode === 'agency' && draft.name.trim() === ''
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded)

  async function pick(file: File | undefined): Promise<void> {
    if (file === undefined) return
    const read = await readLogo(file, LOGO_MAX)
    if (read.ok) patch({ logo: read.dataUrl })
    else setNote({ tone: 'bad', text: read.reason })
  }

  async function submit(): Promise<void> {
    if (nameMissing) {
      setNote({ tone: 'bad', text: 'Type your agency’s name.' })
      return
    }
    if (draft.mode === 'agency' && (websiteProblem || emailProblem)) {
      setNote({ tone: 'bad', text: websiteProblem ?? emailProblem ?? '' })
      return
    }
    setBusy(true)
    try {
      const saved = await save(draft)
      setDraft(saved)
      setNote({
        tone: 'ok',
        text:
          saved.mode === 'none'
            ? 'Saved. Reports show no branding.'
            : 'Saved. Every report and download now shows this.'
      })
      onSaved?.(saved)
    } catch (error) {
      setNote({ tone: 'bad', text: errorText(error, 'Could not save.') })
    } finally {
      setBusy(false)
    }
  }

  const logoField = (
    <div className="field">
      <span className="field-label" id={`${base}-logo`}>
        Logo
      </span>
      <div className="ps-logo-row" aria-labelledby={`${base}-logo`}>
        {draft.logo ? (
          <img className="ps-logo" src={draft.logo} alt="Logo preview" />
        ) : (
          <span className="hint">
            {draft.mode === 'company' ? 'No logo: we use your site’s icon' : 'No logo'}
          </span>
        )}
        <label className="btn btn-secondary btn-sm ps-logo-pick">
          {draft.logo ? 'Change logo' : 'Add logo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </label>
        {draft.logo ? (
          <Button size="sm" variant="ghost" onClick={() => patch({ logo: null })}>
            Remove logo
          </Button>
        ) : null}
      </div>
      <p className="hint">PNG, JPG, WebP or SVG, up to 150 KB. It stays on this computer.</p>
    </div>
  )

  return (
    <div className="rb-form" data-testid="branding-form" data-guide="report-branding">
      <WayList<BrandingMode>
        label="Who are these reports from?"
        name={`${base}-mode`}
        options={MODES}
        value={draft.mode}
        onChange={(mode) => patch({ mode })}
      />
      {draft.mode === 'agency' ? (
        <div className="rb-fields">
          <label className="field" htmlFor={`${base}-name`}>
            <span className="field-label">Agency name</span>
            <input
              id={`${base}-name`}
              className="ob-input"
              value={draft.name}
              maxLength={SENDER_NAME_MAX}
              placeholder="Northwind SEO"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          {logoField}
          <label className="field" htmlFor={`${base}-web`}>
            <span className="field-label">Website</span>
            <input
              id={`${base}-web`}
              className="ob-input"
              value={draft.website}
              maxLength={SENDER_LINK_MAX}
              placeholder="example.com"
              aria-invalid={websiteProblem !== null}
              onChange={(event) => patch({ website: event.target.value })}
            />
          </label>
          {websiteProblem ? <p className="field-error">{websiteProblem}</p> : null}
          <label className="field" htmlFor={`${base}-email`}>
            <span className="field-label">Contact email</span>
            <input
              id={`${base}-email`}
              className="ob-input"
              type="email"
              value={draft.email}
              maxLength={SENDER_LINK_MAX}
              placeholder="hello@example.com"
              aria-invalid={emailProblem !== null}
              onChange={(event) => patch({ email: event.target.value })}
            />
          </label>
          {emailProblem ? <p className="field-error">{emailProblem}</p> : null}
          <p className="hint">
            Each project’s client name and logo live in Project settings › Reports. Empty: the
            project’s brand.
          </p>
        </div>
      ) : null}
      {draft.mode === 'company' ? (
        <div className="rb-fields">
          <label className="field" htmlFor={`${base}-name`}>
            <span className="field-label">Company name</span>
            <input
              id={`${base}-name`}
              className="ob-input"
              value={draft.name}
              maxLength={SENDER_NAME_MAX}
              placeholder={brand || 'Your company'}
              aria-describedby={`${base}-name-hint`}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <p className="hint" id={`${base}-name-hint`}>
            Empty: each project’s brand.
          </p>
          {logoField}
          <label className="field" htmlFor={`${base}-by`}>
            <span className="field-label">Prepared by (optional)</span>
            <input
              id={`${base}-by`}
              className="ob-input"
              value={draft.preparedBy}
              maxLength={SENDER_NAME_MAX}
              placeholder="Growth team"
              onChange={(event) => patch({ preparedBy: event.target.value })}
            />
          </label>
        </div>
      ) : null}
      <div className="inline">
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          disabled={!dirty}
          data-guide="branding-save"
          onClick={() => void submit()}
        >
          Save
        </Button>
        {note ? (
          <p
            className={note.tone === 'bad' ? 'field-error' : 'hint'}
            role={note.tone === 'bad' ? 'alert' : 'status'}
          >
            {note.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}
