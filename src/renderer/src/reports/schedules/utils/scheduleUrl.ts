import {
  isReportFormat,
  isReportScopeKind,
  isScheduledReportKind,
  normalizeExportSections,
  RIVAL_DOMAIN,
  type ExportFormat,
  type ReportFormat,
  type ReportScope,
  type ScheduledReportKind
} from '@shared/domain'
import { formatIds, parseIds } from '../../../scope'
import { drawerHref, openDrawer } from '../../../shell/drawers'
import { sectionHash } from '../../../shell/routes'
import { WHOLE_PROJECT, type ScheduleDraft } from '../../scheduleModel'
import { isReadyFormat, readyReportSeed } from './readyReport'

/** The drawer every schedule opens in (`shell/drawerUrl` DRAWER_KINDS `schedule`). */
export const SCHEDULE_DRAWER = 'schedule'

/** `schedule.id` of a schedule that is not saved yet. */
export const NEW_SCHEDULE = 'new'

export type ScheduleMode = 'view' | 'edit'

/** What the schedule drawer's URL says. */
export interface ScheduleDrawerState {
  /** A schedule id, or `new`. */
  id: string
  mode: ScheduleMode
  /** The schedule a new one copies (Duplicate). */
  from: string | null
  /** Starting values for a new schedule (Export's "Schedule this"). */
  seed: Partial<ScheduleDraft>
}

/** The drawer's values as the URL holds them. */
export function readScheduleDrawer(params: Readonly<Record<string, string>>): ScheduleDrawerState {
  const id = params['schedule.id'] || NEW_SCHEDULE
  const mode: ScheduleMode =
    id === NEW_SCHEDULE || params['schedule.mode'] === 'edit' ? 'edit' : 'view'
  return { id, mode, from: params['schedule.from'] || null, seed: seedFromParams(params) }
}

/** `schedule.preset` values: ready-made schedules. */
export const IMPACT_PRESET = 'impact14'

/**
 * "Impact review every 14 days": after each check (CiteFox re-checks every 14 days by
 * default), a PDF that leads with the verdict, what you published and what changed.
 */
export const IMPACT_PRESET_SEED: Partial<ScheduleDraft> = {
  name: 'Impact review every 14 days',
  trigger: 'after_check',
  format: 'pdf',
  sections: ['overview', 'pages', 'competition', 'trends'],
  subject: '{project}: Impact review for {date_range}'
}

function seedFromParams(params: Readonly<Record<string, string>>): Partial<ScheduleDraft> {
  const seed: Partial<ScheduleDraft> =
    params['schedule.preset'] === IMPACT_PRESET ? { ...IMPACT_PRESET_SEED } : {}
  const project = params['schedule.project']
  if (project) seed.projectId = parseIds(project)[0] ?? null
  const kind = params['schedule.scope']
  if (kind && isReportScopeKind(kind)) {
    const ids = kind === 'project' ? [] : parseIds(params['schedule.ids'])
    seed.scope = ids.length === 0 && kind !== 'project' ? WHOLE_PROJECT : { kind, ids }
  }
  const sections = params['schedule.sec']
  if (sections) {
    seed.sections = sections === 'none' ? [] : normalizeExportSections(sections.split(','))
  }
  const format = params['schedule.fmt']
  if (format && isReportFormat(format)) seed.format = format
  const market = params['schedule.mk']
  if (market) seed.marketIds = parseIds(market)
  const report = params['schedule.report']
  if (report && isScheduledReportKind(report)) {
    const rival = params['schedule.rival']
    Object.assign(
      seed,
      readyReportSeed(report, rival && RIVAL_DOMAIN.test(rival) ? rival : null),
      // A ready report attaches its PDF unless the URL asked for another file it can send.
      { format: seed.format && isReadyFormat(seed.format) ? seed.format : 'pdf' }
    )
  }
  return seed
}

/** The report file a schedule attaches for an export format (JSON has none: the PDF). */
export function reportFormatFor(format: ExportFormat): ReportFormat {
  if (format === 'xlsx') return 'excel'
  if (format === 'csv') return 'csv'
  if (format === 'html') return 'html_link'
  return 'pdf'
}

/** URL values that open a new schedule with these starting values. */
export function scheduleSeedParams(seed: {
  projectId: string | null
  scope: ReportScope
  sections: readonly string[]
  format: ReportFormat
  marketIds: readonly string[]
}): Record<string, string> {
  const out: Record<string, string> = { 'schedule.id': NEW_SCHEDULE }
  if (seed.projectId) out['schedule.project'] = seed.projectId
  out['schedule.scope'] = seed.scope.kind
  const ids = formatIds(seed.scope.ids)
  if (seed.scope.kind !== 'project' && ids) out['schedule.ids'] = ids
  out['schedule.sec'] = seed.sections.length === 0 ? 'none' : seed.sections.join(',')
  out['schedule.fmt'] = seed.format
  const markets = formatIds(seed.marketIds)
  if (markets) out['schedule.mk'] = markets
  return out
}

/** Opens a schedule in the drawer: its details, or straight into editing. */
export function openSchedule(id: string, mode: ScheduleMode = 'view'): void {
  openDrawer(SCHEDULE_DRAWER, {
    'schedule.id': id,
    ...(mode === 'edit' ? { 'schedule.mode': 'edit' } : {})
  })
}

/** URL values that open a new schedule of one ready report (a card's "Email on a schedule"). */
export function readyReportScheduleParams(
  kind: ScheduledReportKind,
  rival: string | null,
  projectId: string | null
): Record<string, string> {
  return {
    'schedule.id': NEW_SCHEDULE,
    'schedule.report': kind,
    ...(kind === 'rival' && rival ? { 'schedule.rival': rival } : {}),
    ...(projectId ? { 'schedule.project': projectId } : {})
  }
}

/** Opens a new schedule, empty or with starting values. */
export function openNewSchedule(values: Record<string, string> = {}): void {
  openDrawer(SCHEDULE_DRAWER, { 'schedule.id': NEW_SCHEDULE, ...values })
}

/** Opens a copy of a schedule in edit: "Copy of …", saved as a new schedule. */
export function openDuplicate(sourceId: string): void {
  openDrawer(SCHEDULE_DRAWER, { 'schedule.id': NEW_SCHEDULE, 'schedule.from': sourceId })
}

/** The link that opens a schedule's details over Reports. */
export function scheduleHref(id: string): string {
  return drawerHref(SCHEDULE_DRAWER, { 'schedule.id': id }, sectionHash('reports'))
}

/** The link that opens one delivery in Reports' Delivery history. */
export function deliveryHash(deliveryId: string): string {
  return `${sectionHash('reports')}?view=history&delivery=${encodeURIComponent(deliveryId)}`
}
