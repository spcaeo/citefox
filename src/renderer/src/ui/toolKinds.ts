import type { UiIconName } from './UiIcon'

/** The tool actions, each with its one icon and its one name. */
export const TOOL_KINDS = {
  download: { icon: 'download', label: 'Download' },
  print: { icon: 'printer', label: 'Print / PDF' },
  schedule: { icon: 'mail', label: 'Email on a schedule' },
  email: { icon: 'mail', label: 'Email' },
  'copy-link': { icon: 'link', label: 'Copy link' },
  copy: { icon: 'copy', label: 'Copy' },
  csv: { icon: 'table', label: 'Download CSV' },
  refresh: { icon: 'refresh', label: 'Refresh' },
  edit: { icon: 'pencil', label: 'Edit' },
  settings: { icon: 'settings', label: 'Settings' },
  filter: { icon: 'filter', label: 'Filter' },
  open: { icon: 'external', label: 'Open in a new window' },
  upload: { icon: 'upload', label: 'Upload' },
  delete: { icon: 'trash', label: 'Delete' }
} as const satisfies Record<string, { icon: UiIconName; label: string }>

export type ToolKind = keyof typeof TOOL_KINDS
