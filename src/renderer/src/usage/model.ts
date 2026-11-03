import { templateKindInfo } from '@shared/domain'
import type { LlmCallRecord, LlmUsage, LlmUsageByConnection } from '@shared/ipc'
import { fallbackAssistTitle } from '../assist/model'

/** 950, 41.2k, 1.3M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.max(0, Math.round(value)))
  if (value < 1_000_000) return `${trimZero((value / 1000).toFixed(1))}k`
  return `${trimZero((value / 1_000_000).toFixed(1))}M`
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/** "CiteFox AI calls today 31 · tokens this month 1.3M in / 196.4k out". */
export function usageSummary(usage: LlmUsage): string {
  return `CiteFox AI calls today ${usage.callsToday} · tokens this month ${formatTokens(usage.tokensInThisMonth)} in / ${formatTokens(usage.tokensOutThisMonth)} out`
}

export function connectionLabel(connection: LlmUsageByConnection['connection']): string {
  return connection === 'claude-code' ? 'CiteFox AI on this computer' : 'Your AI key'
}

/**
 * A readable step name. Assist ids hold a dot (`results.explainChange`);
 * template kinds use underscores (`buyer_profile`).
 */
export function stepLabel(step: string): string {
  if (step === 'other') return 'Other'
  if (step.includes('.')) {
    const title = fallbackAssistTitle(step)
    return title === 'Ask CiteFox AI' ? step : title
  }
  return templateKindInfo(step).label
}

/** The step a logged call belongs to, as `byStep` groups it. */
export function callStep(record: LlmCallRecord): string {
  return record.assistId ?? record.templateKind ?? 'other'
}

/** "6 s" from milliseconds, at least 1 s. */
export function formatSeconds(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))} s`
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}
