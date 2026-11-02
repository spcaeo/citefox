import type { AssistDefinition } from './types'

/**
 * Every assist the engine can run. Screens owned by other areas add theirs with
 * `registerAssist` (for example from their own definitions module imported by
 * `definitions/index.ts`); `assist:run` then accepts the id with no channel change.
 */
const ASSISTS = new Map<string, AssistDefinition>()

export function registerAssist(definition: AssistDefinition): void {
  if (ASSISTS.has(definition.id)) throw new Error(`Assist ${definition.id} is registered twice`)
  ASSISTS.set(definition.id, definition)
}

export function registerAssists(definitions: readonly AssistDefinition[]): void {
  for (const definition of definitions) registerAssist(definition)
}

export function getAssist(id: string): AssistDefinition | null {
  return ASSISTS.get(id) ?? null
}

export function listAssistIds(): string[] {
  return [...ASSISTS.keys()]
}
