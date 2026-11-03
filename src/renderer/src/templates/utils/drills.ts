import { templateKindInfo, type GenerationTemplate } from '@shared/domain'
import type {
  LlmCallList,
  LlmCallRecord,
  TemplateStep,
  TemplateUsageDetail,
  TemplateUsageItem,
  TemplateUsageItemKind,
  TemplateVersionEntry
} from '@shared/ipc'
import type { DrillItem, DrillScope, ItemDrill } from '../../drill'
import { formatReadStamp } from '../../pageSetup/model'
import { formatMoment } from '../../utils/dates'
import type { PageTabId } from '../../shell/routes'
import { hashPrefix } from './stepCopy'

/**
 * Drill-downs on Templates (REPORT-SPEC "Interaction model"): a step's
 * version history, the Claude calls behind "Last run", and the saved
 * artifacts behind an app template's usage count. Each drawer lists exactly
 * the rows behind the control that opened it.
 */

export const NO_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

/** The usage item kind a template kind saves, or null when it saves none. */
export function usageItemKind(kind: string): TemplateUsageItemKind | null {
  if (kind === 'buyer_profile') return 'buyer_profile'
  if (kind === 'buyer_prompts') return 'prompt_set'
  if (kind === 'coverage' || kind === 'coverage_matrix') return 'coverage'
  return null
}

const ITEM_TAB: Readonly<Record<TemplateUsageItemKind, PageTabId>> = {
  buyer_profile: 'audience',
  prompt_set: 'prompts',
  coverage: 'gaps'
}

const ITEM_NOUN: Readonly<Record<TemplateUsageItemKind, string>> = {
  buyer_profile: 'Buyer profile',
  prompt_set: 'Question set',
  coverage: 'Coverage matrix'
}

function dateTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso
  return formatMoment(iso)
}

function seconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 100) / 10)} s`
}

/**
 * The saved artifacts behind an app template's usage line. Only the items of
 * the template's own kind are listed, so the total equals the shown count.
 * Pages in the open project open that tab; others name their project.
 */
export function usageDrill(
  template: GenerationTemplate,
  detail: TemplateUsageDetail,
  activeProjectId: string | null
): ItemDrill {
  const itemKind = usageItemKind(template.kind)
  const nouns = templateKindInfo(template.kind).usageNoun
  const rows = detail.items.filter((item) => item.kind === itemKind)
  const items: DrillItem[] = rows.map((item: TemplateUsageItem) => {
    const here = activeProjectId !== null && item.projectId === activeProjectId
    return {
      id: item.id,
      primary: item.pageLabel,
      secondary: here
        ? `${ITEM_NOUN[item.kind]} · ${item.pageUrl || item.pageId}`
        : `${ITEM_NOUN[item.kind]} · in ${item.projectName}. Open that project to see it.`,
      target: here ? { kind: 'page', pageId: item.pageId, tab: ITEM_TAB[item.kind] } : null,
      cells: {
        saved: formatReadStamp(item.savedAt),
        hash: item.templateHash ? hashPrefix(item.templateHash) : '—',
        project: item.projectName
      }
    }
  })
  return {
    kind: 'items',
    id: `template-usage:${template.id}`,
    title: `${template.name}: ${nouns[1]}`,
    description: `Every saved ${nouns[0]} that recorded this template, newest first. Playground runs are not saved, so they are not listed.`,
    noun: nouns,
    primaryLabel: 'Page',
    columns: [
      { id: 'saved', label: 'Saved', width: '110px' },
      { id: 'hash', label: 'Hash', width: '72px' },
      { id: 'project', label: 'Project', width: 'minmax(90px, 0.7fr)' }
    ],
    items,
    note: 'Select a page in this project to open the tab with that saved version.',
    scope: NO_SCOPE
  }
}

/** One call's version label: the saved version whose hash it ran, or the hash. */
function callVersion(call: LlmCallRecord, versions: readonly TemplateVersionEntry[]): string {
  if (!call.templateHash) return '—'
  const match = versions.find((entry) => entry.hash === call.templateHash)
  return match ? `v${match.version}` : hashPrefix(call.templateHash)
}

function callLine(call: LlmCallRecord): string {
  const result = call.ok ? 'OK' : `Failed: ${call.error ?? 'no reason recorded'}`
  return `- ${dateTime(call.startedAt)} · ${result} · ${seconds(call.durationMs)}`
}

/**
 * The step's saved versions, newest first, each with the Claude calls that
 * ran that exact wording (matched by hash). A row expands to those calls.
 */
export function versionsDrill(
  step: TemplateStep,
  versions: readonly TemplateVersionEntry[],
  calls: LlmCallList | null
): ItemDrill {
  const info = templateKindInfo(step.kind)
  const items: DrillItem[] = versions.map((entry) => {
    const used = (calls?.calls ?? []).filter((call) => call.templateHash === entry.hash)
    const shown = used.slice(0, 10)
    return {
      id: `${entry.source}-${entry.version}`,
      primary: `v${entry.version}${entry.current ? ' (current)' : ''}`,
      mono: true,
      secondary: `${entry.source === 'project' ? 'Project version' : 'App template'} · hash ${entry.hash}`,
      cells: {
        saved: formatReadStamp(entry.savedAt),
        hash: hashPrefix(entry.hash),
        calls: calls === null ? '—' : used.length
      },
      detail:
        used.length === 0
          ? 'No logged AI call ran this wording.'
          : `AI calls that ran this wording${used.length > shown.length ? ` (newest ${shown.length} of ${used.length})` : ''}:\n\n${shown.map(callLine).join('\n')}`,
      group: entry.current ? 'current' : 'earlier'
    }
  })
  return {
    kind: 'items',
    id: `template-versions:${step.kind}`,
    title: `${info.label}: version history`,
    description:
      'Every saved version of what this step runs, newest first. Each check records the hash of the wording it used, so the calls column counts the logged AI calls that ran that version.',
    noun: ['version', 'versions'],
    primaryLabel: 'Version',
    columns: [
      { id: 'saved', label: 'Saved', width: '110px' },
      { id: 'hash', label: 'Hash', width: '72px' },
      { id: 'calls', label: 'Calls', align: 'end', width: '64px' }
    ],
    items,
    summary: [
      { label: 'Current', group: 'current' },
      { label: 'Earlier', group: 'earlier' }
    ],
    note: 'Expand a version to see the calls that ran it.',
    scope: NO_SCOPE
  }
}

/** The logged Claude calls behind a step's "Last run", newest first. */
export function callsDrill(
  step: TemplateStep,
  list: LlmCallList,
  versions: readonly TemplateVersionEntry[]
): ItemDrill {
  const info = templateKindInfo(step.kind)
  const items: DrillItem[] = list.calls.map((call) => ({
    id: call.id,
    primary: dateTime(call.startedAt),
    secondary: [
      call.connection === 'anthropic-api' ? 'CiteFox AI · your AI key' : 'CiteFox AI',
      call.model,
      call.source
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    cells: {
      result: call.ok ? 'OK' : 'Failed',
      version: callVersion(call, versions),
      duration: seconds(call.durationMs),
      tokens: `${call.tokensIn.toLocaleString('en-US')} / ${call.tokensOut.toLocaleString('en-US')}`
    },
    detail: call.ok ? null : `Failed: ${call.error ?? 'no reason recorded'}`,
    group: call.ok ? 'ok' : 'failed'
  }))
  const more = list.total > list.calls.length
  return {
    kind: 'items',
    id: `template-calls:${step.kind}`,
    title: `${info.label}: AI calls`,
    description: more
      ? `The newest ${list.calls.length} of ${list.total.toLocaleString('en-US')} logged calls of this step. CiteFox logs timing and tokens only, never the prompt or the reply.`
      : 'Every logged call of this step, newest first. CiteFox logs timing and tokens only, never the prompt or the reply.',
    noun: ['call', 'calls'],
    primaryLabel: 'Started',
    columns: [
      { id: 'result', label: 'Result', width: '72px' },
      { id: 'version', label: 'Version', width: '72px' },
      { id: 'duration', label: 'Time', align: 'end', width: '64px' },
      { id: 'tokens', label: 'Tokens in / out', align: 'end', width: '120px' }
    ],
    items,
    summary: [
      { label: 'OK', group: 'ok' },
      { label: 'Failed', group: 'failed' }
    ],
    note: 'Expand a failed call to read why.',
    scope: NO_SCOPE
  }
}
