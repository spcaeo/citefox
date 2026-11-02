import type { JSX } from 'react'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import { Panel } from '../../../ui'
import { FORMAT_DEFS, FORMAT_SHORT } from '../formats'
import type { ExportForm } from '../model'
import { ChoiceGroup } from './ChoiceGroup'

/** File format and the options for that format. */
export function FormatCard({
  form,
  onPatch
}: {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
}): JSX.Element {
  const picked = FORMAT_DEFS.find((format) => format.id === form.format)
  const ext = form.format === 'html' && form.htmlPackaging === 'file' ? '.html' : picked?.ext
  return (
    <Panel title="Format" titleAs="h2" className="xpt-panel">
      <fieldset className="xpt-group" role="radiogroup" aria-label="Format">
        <div className="xpt-seg">
          {FORMAT_DEFS.map((format) => (
            <label
              className={form.format === format.id ? 'xpt-seg-opt on' : 'xpt-seg-opt'}
              key={format.id}
              title={format.name}
            >
              <input
                type="radio"
                name="format"
                value={format.id}
                checked={form.format === format.id}
                onChange={() => onPatch({ format: format.id })}
              />
              <span>{FORMAT_SHORT[format.id]}</span>
            </label>
          ))}
        </div>
        {picked ? (
          <p className="xpt-help">
            {picked.desc} <span className="mono">{ext}</span>
          </p>
        ) : null}
      </fieldset>
      <FormatOptions form={form} onPatch={onPatch} />
    </Panel>
  )
}

function FormatOptions({
  form,
  onPatch
}: {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
}): JSX.Element {
  switch (form.format) {
    case 'html':
      return (
        <div className="xpt-opts">
          <ChoiceGroup
            name="html-packaging"
            legend="Packaging"
            legendClassName="field-label"
            variant="seg"
            value={form.htmlPackaging}
            onChange={(htmlPackaging) => onPatch({ htmlPackaging })}
            choices={[
              {
                value: 'zip',
                label: 'Folder as .zip',
                hint: 'index.html and a README.txt, zipped.'
              },
              { value: 'file', label: 'Single index.html', hint: 'One file, nothing else.' }
            ]}
          />
          <p className="xpt-help">
            Everything is inside the file: no internet connection, fonts or trackers. Print it from
            the browser for the whole report on paper.
          </p>
        </div>
      )
    case 'pdf':
      return (
        <div className="xpt-opts">
          <ChoiceGroup
            name="page-size"
            legend="Page size"
            legendClassName="field-label"
            variant="seg"
            value={form.pageSize}
            onChange={(pageSize) => onPatch({ pageSize })}
            choices={[
              { value: 'letter', label: 'Letter' },
              { value: 'a4', label: 'A4' }
            ]}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={form.charts}
              onChange={() => onPatch({ charts: !form.charts })}
            />
            Include charts
          </label>
          <div className="field">
            <label className="field-label" htmlFor="prepared">
              Prepared for
            </label>
            <input
              id="prepared"
              className="ui-input"
              placeholder="Client name"
              value={form.preparedFor}
              onChange={(event) => onPatch({ preparedFor: event.target.value })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.hideBranding}
              onChange={() => onPatch({ hideBranding: !form.hideBranding })}
            />
            Hide CiteFox branding
          </label>
        </div>
      )
    case 'xlsx':
      return (
        <div className="xpt-opts">
          <label className="check">
            <input
              type="checkbox"
              checked={form.freezeHeaders}
              onChange={() => onPatch({ freezeHeaders: !form.freezeHeaders })}
            />
            Freeze header rows
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.sheetPerMarket}
              onChange={() => onPatch({ sheetPerMarket: !form.sheetPerMarket })}
            />
            One sheet per market
          </label>
        </div>
      )
    case 'csv':
      return (
        <div className="xpt-opts">
          <ChoiceGroup
            name="delimiter"
            legend="Delimiter"
            legendClassName="field-label"
            variant="seg"
            value={form.delimiter}
            onChange={(delimiter) => onPatch({ delimiter })}
            choices={[
              { value: 'comma', label: 'Comma' },
              { value: 'semicolon', label: 'Semicolon' }
            ]}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={form.bom}
              onChange={() => onPatch({ bom: !form.bom })}
            />
            UTF-8 with BOM, so Excel opens it cleanly
          </label>
        </div>
      )
    case 'json':
      return (
        <div className="xpt-opts">
          <p className="xpt-help">
            One .json file in schema v2. Field names stay the same between versions, so scripts keep
            working.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={form.includeRaw}
              onChange={() => onPatch({ includeRaw: !form.includeRaw })}
            />
            <span className="stack">
              <span>Include {REPORT_SECTION_COPY.raw.title}</span>
              <span className="sub">{REPORT_SECTION_COPY.raw.description} Large.</span>
            </span>
          </label>
        </div>
      )
  }
}
