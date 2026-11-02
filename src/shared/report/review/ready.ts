import { contentPlanView } from './content-plan'
import type { ReportExtras } from './extras'
import { pitchView } from './pitch'
import type { ReadyView } from './ready-types'
import { rivalView } from './rival'
import type { SectionInput } from './sections'
import type { ReviewReport } from './types'

/**
 * The three short ready reports (Docs/REPORT-SPEC.md "Short ready reports"), built from
 * the report's own views so they show the same numbers as the longer reports: Pitch /
 * audit (pitch.ts), Content plan (content-plan.ts) and Head-to-head (rival.ts).
 */

export interface ReadyInput extends SectionInput {
  extras: ReportExtras
  report: Pick<
    ReviewReport,
    'standing' | 'visibility' | 'competition' | 'sources' | 'answerShape' | 'questionsById'
  >
}

export function readyView(input: ReadyInput): ReadyView {
  return { pitch: pitchView(input), content: contentPlanView(input), rival: rivalView(input) }
}
