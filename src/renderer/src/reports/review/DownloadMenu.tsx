import type { JSX } from 'react'
import type { ReportTable } from '@shared/ipc'
import { ExportMenu, type MenuItem } from '../../ui'
import type { DownloadFormat } from './useReportDownload'

const TABLES: readonly { id: ReportTable; label: string }[] = [
  { id: 'questions', label: 'Questions' },
  { id: 'pages', label: 'Published pages' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'sitekinds', label: 'Kinds of site' },
  { id: 'topics', label: 'Topics' },
  { id: 'notindexed', label: 'Not indexed' },
  { id: 'backlinks', label: 'Backlinks' },
  { id: 'contentplan', label: 'Content plan' }
]

/**
 * Download ▾: the download icon (ExportMenu) opening the whole report as one offline
 * HTML file or a PDF, or one table as CSV (Docs/DESIGN-GUIDELINES.md: tools are icons).
 */
export function DownloadMenu({
  onDownload,
  busy,
  label = 'Download'
}: {
  onDownload: (format: DownloadFormat, table?: ReportTable) => void
  busy: boolean
  label?: string
}): JSX.Element {
  const items: MenuItem[] = [
    {
      id: 'html',
      label: 'Offline HTML',
      hint: 'One file',
      icon: 'download',
      groupLabel: 'Whole report',
      onSelect: () => onDownload('html')
    },
    {
      id: 'pdf',
      label: 'PDF',
      hint: 'Every table in full',
      icon: 'download',
      onSelect: () => onDownload('pdf')
    },
    ...TABLES.map((table, index) => ({
      id: `csv-${table.id}`,
      label: `${table.label} (CSV)`,
      ...(index === 0 ? { groupStart: true, groupLabel: 'One table as CSV' } : {}),
      onSelect: () => onDownload('csv', table.id)
    }))
  ]
  return <ExportMenu items={items} label={label} busy={busy} />
}
