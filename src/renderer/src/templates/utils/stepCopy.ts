import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  sameTemplateSettings,
  templateKindInfo,
  type TemplateSettings
} from '@shared/domain'
import type {
  EffectiveTemplate,
  TemplateStep,
  TemplateStepStatus,
  TemplateVersionEntry,
  TryTemplateResult
} from '@shared/ipc'
import { formatReadStamp } from '../../pageSetup/model'

/** Copy for the step list and the step editor (Templates.dc.html, FR-26.1 to FR-26.8). */

export const STEP_STATUSES: readonly TemplateStepStatus[] = ['shipped', 'edited', 'project']

export const STEP_STATUS_LABEL: Readonly<Record<TemplateStepStatus, string>> = {
  shipped: 'Default',
  edited: 'Edited',
  project: 'Overridden for this project'
}

/** Chip tone per status (v2 Chip tones). */
export const STEP_STATUS_TONE: Readonly<Record<TemplateStepStatus, 'neutral' | 'info' | 'ok'>> = {
  shipped: 'neutral',
  edited: 'info',
  project: 'ok'
}

export const PROJECT_SCOPE_NOTE =
  'Your edits apply to this project only; the default stays available.'

export const APP_SCOPE_NOTE =
  'No project is open, so you are editing the app templates every project shares. Open a project to give it its own version.'

export const IMPROVE_APPLIED_NOTE =
  'Added to the template below. Review the wording, then Save. Saving makes a new version.'

export const TRY_SAVED_NOTHING = 'Nothing is saved to the page.'

export const OUTPUT_FIELDS_NOTE =
  "CiteFox checks CiteFox AI's answer against these fields and retries once if they don't match."

/** Where a Claude step runs: page checks, topic tracking, reports, or Ask CiteFox answers. */
export type StepArea = 'pages' | 'topics' | 'reports' | 'assistant'

export const STEP_AREAS: readonly StepArea[] = ['pages', 'topics', 'reports', 'assistant']

export const STEP_AREA_LABEL: Readonly<Record<StepArea, string>> = {
  pages: 'Pages',
  topics: 'Topics',
  reports: 'Reports',
  assistant: 'Ask CiteFox'
}

export const STEP_AREA_NOTE: Readonly<Record<StepArea, string>> = {
  pages: 'Buyer profile, questions and the checks of one page',
  topics: 'Seeds, questions, keywords and fixes for topics',
  reports: 'Summaries in reports and exports',
  assistant: 'Answers in the Ask CiteFox drawer, from stored checks only'
}

const REPORT_KINDS: readonly string[] = ['run_summary']

/** The step's area. Topic kinds come from the shared topics contract. */
export function stepArea(kind: string): StepArea {
  if ((TOPIC_TEMPLATE_KINDS as readonly string[]).includes(kind)) return 'topics'
  if (REPORT_KINDS.includes(kind)) return 'reports'
  if ((ASSISTANT_TEMPLATE_KINDS as readonly string[]).includes(kind)) return 'assistant'
  return 'pages'
}

/** Each step's 1-based number inside its area, in run order. */
export function areaPositions(
  steps: readonly Pick<TemplateStep, 'kind' | 'position'>[]
): Map<string, number> {
  const seen: Record<StepArea, number> = { pages: 0, topics: 0, reports: 0, assistant: 0 }
  const numbers = new Map<string, number>()
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    const area = stepArea(step.kind)
    seen[area] += 1
    numbers.set(step.kind, seen[area])
  }
  return numbers
}

/** "9b1f…". The full hash stays in the version history's title. */
export function hashPrefix(hash: string): string {
  return hash.length <= 4 ? hash : `${hash.slice(0, 4)}…`
}

/** "v3 · hash 9b1f…" */
export function versionLine(template: Pick<EffectiveTemplate, 'version' | 'hash'>): string {
  return `v${template.version} · hash ${hashPrefix(template.hash)}`
}

export function savedNote(template: Pick<EffectiveTemplate, 'version' | 'hash'>): string {
  return `Saved as ${versionLine(template)}. Existing question sets and past checks don't change; the next step that uses this template runs with the new wording.`
}

/** "v3": the version alone, for a grid cell (the hash goes in its tooltip). */
export function versionShort(template: Pick<EffectiveTemplate, 'version'>): string {
  return `v${template.version}`
}

/** "Oct 19" for the Last run cell, or null before the step has run in this project. */
export function lastRunDay(step: TemplateStep): string | null {
  return step.lastRunAt === null ? null : formatReadStamp(step.lastRunAt)
}

export function lastRunLine(step: TemplateStep, projectOpen: boolean): string | null {
  if (!projectOpen) return null
  if (step.lastRunAt === null) return 'Not run in this project yet'
  return `Last run ${formatReadStamp(step.lastRunAt)}`
}

/** The row's second line: version, then last run when a project is open. */
export function stepWhenLine(step: TemplateStep, projectOpen: boolean): string {
  const last = lastRunLine(step, projectOpen)
  return last === null ? versionLine(step.effective) : `${versionLine(step.effective)} · ${last}`
}

export function stepSearchText(step: TemplateStep): string {
  const info = templateKindInfo(step.kind)
  return `${info.label} ${info.file} ${step.kind}`.toLowerCase()
}

export function stepListLabel(shown: number, total: number, filtering: boolean): string {
  const noun = total === 1 ? 'step' : 'steps'
  if (!filtering) return `${total} ${noun}`
  return `Showing ${shown} of ${total} ${noun}`
}

export function versionEntryLine(entry: TemplateVersionEntry): string {
  return `v${entry.version} · hash ${hashPrefix(entry.hash)} · Saved ${formatReadStamp(entry.savedAt)}`
}

/** "Uses your Claude plan · about 15 s" */
export function tryCostLabel(
  connection: 'claude-code' | 'anthropic-api' | 'codex',
  seconds: number
): string {
  const plan = connection === 'anthropic-api' ? 'Uses your AI key' : 'Uses your AI plan'
  return `${plan} · about ${Math.max(1, Math.round(seconds))} s`
}

/** "Claude returned a buyer profile in 12 s. It matched the output fields." */
export function tryResultLine(kind: string, result: TryTemplateResult): string {
  const seconds = Math.max(1, Math.round(result.durationMs / 1000))
  if (result.matched) {
    return `CiteFox AI returned ${withArticle(templateKindInfo(kind).usageNoun[0])} in ${seconds} s. It matched the output fields.`
  }
  const problem = result.problem ?? 'The answer did not match the output fields.'
  return `CiteFox AI answered in ${seconds} s, but the answer did not match the output fields. ${problem}`
}

export function sameDraft(
  body: string,
  settings: TemplateSettings,
  base: { body: string; settings: TemplateSettings }
): boolean {
  return body === base.body && sameTemplateSettings(settings, base.settings)
}

function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`
}
