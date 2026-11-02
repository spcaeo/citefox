import { useEffect, useId, useState, type JSX } from 'react'
import {
  LOGO_MAX,
  NO_BRANDING,
  PREPARED_FOR_MAX,
  type ReportBranding
} from '@shared/report/review/extras'
import { useReportSender } from '../../reports/branding/senderStore'
import { brandingMode } from '@shared/report/review/sender'
import { appSettingsHash } from '../../shell/routes'
import { Button } from '../../ui'
import { useSave } from '../hooks/useSave'
import { readLogo, type BrandingClient } from '../utils/branding'
import { SaveStatus, Section } from './bits'

/**
 * Project settings › Reports: the optional "Prepared for <client>" line and logo on
 * downloaded reports. Empty: no line. Its words follow Settings › Reports: an agency
 * names its client here (empty: the project's brand); an in-house team names the team
 * the reports are for and who prepared them, with no logo and no "client".
 */
export function ReportsSection({
  projectId,
  client,
  brand = ''
}: {
  projectId: string
  client: BrandingClient
  brand?: string
}): JSX.Element {
  const { sender } = useReportSender()
  const mode = brandingMode(sender)
  const base = useId()
  const [saved, setSaved] = useState<ReportBranding>(NO_BRANDING)
  const [name, setName] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [by, setBy] = useState('')
  const save = useSave()

  useEffect(() => {
    let live = true
    client.get(projectId).then(
      (value) => {
        if (!live) return
        setSaved(value)
        setName(value.preparedFor)
        setLogo(value.logo)
        setBy(value.preparedBy ?? '')
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [client, projectId])

  const dirty =
    name.trim() !== saved.preparedFor ||
    logo !== saved.logo ||
    by.trim() !== (saved.preparedBy ?? '')

  async function pick(file: File | undefined): Promise<void> {
    if (file === undefined) return
    const read = await readLogo(file, LOGO_MAX)
    if (read.ok) setLogo(read.dataUrl)
    else save.fail(read.reason)
  }

  async function submit(): Promise<void> {
    await save.run(
      async () => {
        const next = await client.set({
          projectId,
          preparedFor: name,
          logo,
          ...(by.trim() !== '' ? { preparedBy: by } : {})
        })
        setSaved(next)
        setName(next.preparedFor)
        setLogo(next.logo)
        setBy(next.preparedBy ?? '')
      },
      mode !== 'none'
        ? 'Saved. This project’s reports now show it.'
        : name.trim() === '' && logo === null
          ? 'Removed the line from downloaded reports.'
          : 'Saved. Downloaded reports now show this line.'
    )
  }

  return (
    <Section
      id="ps-reports-brand"
      title="Downloaded reports"
      intro={
        mode === 'agency'
          ? `Your client’s name and logo on this project’s reports. Empty: ${brand || 'the project’s brand'}.`
          : mode === 'company'
            ? 'Optional: who these reports are for, and who prepared them.'
            : 'Add a “Prepared for” line with your client’s or your own name and logo. Leave it empty to show no line.'
      }
    >
      <p className="hint">
        {mode === 'none'
          ? 'Your agency or company name and logo, for every project: '
          : 'Who the reports are from, for every project: '}
        <a href={appSettingsHash('reports')}>Settings › Reports</a>
      </p>
      <label className="field" htmlFor={`${base}-name`}>
        <span className="field-label">{mode === 'agency' ? 'Client name' : 'Prepared for'}</span>
        <input
          id={`${base}-name`}
          className="ob-input"
          value={name}
          maxLength={PREPARED_FOR_MAX}
          placeholder={
            mode === 'agency'
              ? brand || 'Example Co'
              : mode === 'company'
                ? 'Leadership team'
                : 'Example Co'
          }
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {mode === 'company' ? (
        <label className="field" htmlFor={`${base}-by`}>
          <span className="field-label">Prepared by</span>
          <input
            id={`${base}-by`}
            className="ob-input"
            value={by}
            maxLength={PREPARED_FOR_MAX}
            placeholder={sender?.preparedBy || 'Growth team'}
            onChange={(event) => setBy(event.target.value)}
          />
        </label>
      ) : null}
      <div className="field" hidden={mode === 'company'}>
        <span className="field-label" id={`${base}-logo`}>
          Logo
        </span>
        <div className="ps-logo-row" aria-labelledby={`${base}-logo`}>
          {logo ? (
            <img className="ps-logo" src={logo} alt="Logo preview" />
          ) : (
            <span className="hint">No logo</span>
          )}
          <label className="btn btn-secondary btn-sm ps-logo-pick">
            {logo ? 'Change logo' : 'Add logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
          </label>
          {logo ? (
            <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>
              Remove logo
            </Button>
          ) : null}
        </div>
        <p className="hint">PNG, JPG, WebP or SVG, up to 150 KB. It stays on this computer.</p>
      </div>
      {mode === 'none' && (name.trim() !== '' || logo) ? (
        <div className="ps-prepared-preview" role="group" aria-label="Preview">
          {logo ? <img className="ps-logo" src={logo} alt="" /> : null}
          {name.trim() !== '' ? (
            <span>
              Prepared for <b>{name.trim()}</b>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="inline">
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void submit()}>
          Save
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
