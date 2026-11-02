import type { AllPageRow } from '@shared/ipc'
import { pageLabel, pageStatusLabel, setupStepLabel } from '../../projects/copy'

export function rowName(row: AllPageRow): string {
  return pageLabel(row)
}

export function statusText(row: AllPageRow): string {
  const step = row.status === 'setting_up' ? setupStepLabel(row.setupStep) : null
  return step ? `${pageStatusLabel(row.status)} · ${step}` : pageStatusLabel(row.status)
}
