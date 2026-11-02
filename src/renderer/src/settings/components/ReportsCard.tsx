import type { JSX } from 'react'
import { BrandingForm } from '../../reports/branding/BrandingForm'
import { Panel } from '../../ui'

/**
 * Settings › Reports: who the reports are from, set once for every project. Each
 * project's "Prepared for" line stays in Project settings › Reports.
 */
export function ReportsCard({ brand = '' }: { brand?: string }): JSX.Element {
  return (
    <Panel title="Report branding">
      <p className="hint">On every report, download and email.</p>
      <BrandingForm brand={brand} />
    </Panel>
  )
}
