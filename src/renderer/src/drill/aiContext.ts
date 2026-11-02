import type { AiContextPatch, AiEntityRef } from '../assistant/context/types'
import { countNoun } from '../m3/model'
import type { DrillScope } from './types'

/** What a drill drawer tells Ask CiteFox: its title, its market and check, and how many rows it lists. */
export function drillAiPatch(drill: {
  title: string
  scope: DrillScope
  total: number
  noun: readonly [string, string]
  /** The topic a topic drill is about. */
  topicId?: string
  /** The picked tile and the search, when the list is narrowed. */
  filters?: Readonly<Record<string, string>>
}): AiContextPatch {
  const { scope } = drill
  const entities: AiEntityRef[] = []
  if (scope.marketLabel) {
    entities.push({ kind: 'market', id: scope.marketId, label: scope.marketLabel })
  }
  if (scope.checkDateLabel) {
    entities.push({ kind: 'check', id: scope.runId, label: scope.checkDateLabel })
  }
  return {
    screen: 'drawer.drill',
    screenLabel: drill.title,
    ...(drill.topicId ? { topicId: drill.topicId } : {}),
    entities,
    numbers: [{ label: drill.title, value: countNoun(drill.total, drill.noun[0], drill.noun[1]) }],
    ...(drill.filters ? { filters: drill.filters } : {})
  }
}
