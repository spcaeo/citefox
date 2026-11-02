import type { UiIconName, WayOption } from '../ui'
import { START_WAYS, wayExamples, type ExampleProfile, type StartWay } from './examples'

/**
 * The one list of ways to start, shared by "How do you want to start?"
 * (`#/start/choose`) and "What do you want to track?" (`#/add`), so both show
 * the same ways in the same order and the count in the copy matches.
 */
export const START_WAY_ICONS: Record<StartWay, UiIconName> = {
  page: 'file',
  seed: 'target',
  keywords: 'layers',
  questions: 'clipboard',
  competitor: 'crosshair',
  gsc: 'search'
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

/** "Six ways to start", counted from the list. */
export const WAYS_TO_START_LABEL = `${COUNT_WORDS[START_WAYS.length] ?? START_WAYS.length} ways to start`

/** Each way as a chooser row, with a one-line example from the saved profile. */
export function startWayOptions(
  profile: ExampleProfile,
  suggestedSeed?: string | null
): WayOption<StartWay>[] {
  return wayExamples(profile, suggestedSeed).map((item) => ({
    id: item.id,
    icon: START_WAY_ICONS[item.id],
    title: item.title,
    example: item.example,
    later: !item.available
  }))
}
