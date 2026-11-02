import { ALERT_RULE_KIND } from './kinds/alert-rule'
import { BUYERS_KIND } from './kinds/buyers'
import { COMPETITORS_KIND } from './kinds/competitors'
import { FIX_KIND } from './kinds/fix'
import { MARKETS_KIND } from './kinds/markets'
import { MATCH_PAGES_KIND } from './kinds/match-pages'
import { PITCH_KIND } from './kinds/pitch'
import { PROJECT_KIND } from './kinds/project'
import { QUESTIONS_KIND } from './kinds/questions'
import { REPORT_SUMMARY_KIND } from './kinds/report'
import { TOPIC_KIND } from './kinds/topic'
import type { HelpFillKindDef } from './types'

/**
 * Every place "✦ Help me fill this" knows (Docs/HELPFILL.md). A later place adds
 * its kind with `registerHelpFillKind` (one entry in `SHIPPED_KINDS`); the
 * `helpfill:*` channels then accept it with no contract change.
 */
const KINDS = new Map<string, HelpFillKindDef>()

/** The kinds that ship. Add a new place here. */
const SHIPPED_KINDS: readonly HelpFillKindDef[] = [
  QUESTIONS_KIND,
  FIX_KIND,
  PITCH_KIND,
  ALERT_RULE_KIND,
  REPORT_SUMMARY_KIND,
  COMPETITORS_KIND,
  MATCH_PAGES_KIND,
  PROJECT_KIND,
  BUYERS_KIND,
  MARKETS_KIND,
  TOPIC_KIND
]

let shipped = false

export function registerHelpFillKind(definition: HelpFillKindDef): void {
  if (KINDS.has(definition.kind)) {
    throw new Error(`Help-fill kind ${definition.kind} is registered twice`)
  }
  if (definition.sections.length === 0 || definition.sections.some((s) => s.columns.length === 0)) {
    throw new Error(`Help-fill kind ${definition.kind} needs a section with columns`)
  }
  KINDS.set(definition.kind, definition)
}

export function ensureShippedHelpFillKinds(): void {
  if (shipped) return
  shipped = true
  for (const definition of SHIPPED_KINDS) registerHelpFillKind(definition)
}

export function getHelpFillKind(kind: string): HelpFillKindDef | null {
  ensureShippedHelpFillKinds()
  return KINDS.get(kind) ?? null
}

export function listHelpFillKinds(): string[] {
  ensureShippedHelpFillKinds()
  return [...KINDS.keys()]
}
