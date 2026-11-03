import { openDrawer } from '../shell/drawers'

/** The drawer's kind, its URL key for "Include my question texts", and the project it reads. */
export const REPORT_DRAWER = 'report-problem'
export const REPORT_QUESTIONS_PARAM = 'rp.q'
export const REPORT_PROJECT_PARAM = 'rp.project'

/**
 * Opens Report a problem over the current screen (Settings, Help › Report a problem…,
 * a failed check). `projectId` is the open project, an opaque id; null reads every project.
 */
export function openReportProblem(projectId: string | null = null): void {
  openDrawer(REPORT_DRAWER, projectId === null ? {} : { [REPORT_PROJECT_PARAM]: projectId })
}
