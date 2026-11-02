import { isGenerationTemplateKind, type ProjectTemplateOverride } from '@shared/domain'
import { settingsOfRecord, templateHash } from '../../pipeline/templates'
import type { SqliteDatabase } from '../../storage/database'
import { getTemplate, listTemplates } from '../../storage/template-records'
import {
  getCurrentOverride,
  insertTemplateOverride,
  listCurrentOverrides,
  resetTemplateOverrides
} from '../../storage/template-overrides'

/**
 * TPL-1. Project settings' "Templates" choices, stored in the one place a project's
 * templates live: the versioned `template_overrides` table the template editor uses
 * (FR-26.8). Choosing a named app template for a step saves its body and settings as
 * the project's next version of that step, with the chosen template as its base;
 * choosing "Uses app default" resets the step. Generation, coverage and reports read
 * them through `loadGenerationTemplate`. The legacy `project_options.template_overrides`
 * column is no longer read or written.
 */

interface Clock {
  now: string
  createId: () => string
}

/** The app default of a kind, or null when the kind has none yet. */
function defaultTemplateId(appDb: SqliteDatabase, kind: string): string | null {
  return (
    listTemplates(appDb).find(
      (record) => record.kind === kind && record.isDefault && record.deletedAt === null
    )?.id ?? null
  )
}

/**
 * Steps whose current project version is based on a named template other than the app
 * default: that is a Project settings choice. A version written in the template editor
 * from the default is the project's own wording and is not listed here.
 */
export function projectTemplateChoices(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase
): ProjectTemplateOverride[] {
  const choices: ProjectTemplateOverride[] = []
  for (const [kind, override] of listCurrentOverrides(projectDb)) {
    if (!isGenerationTemplateKind(kind)) continue
    if (override.baseTemplateId === defaultTemplateId(appDb, kind)) continue
    choices.push({ kind, templateId: override.baseTemplateId })
  }
  return choices
}

/**
 * Saves the choices. A listed step whose current version already has that base is left
 * alone (so editor changes made on top of a choice stay). A step that had a choice and
 * is no longer listed goes back to the app default. Template ids are checked by the caller.
 */
export function applyTemplateChoices(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  choices: readonly ProjectTemplateOverride[],
  clock: Clock
): void {
  const wanted = new Map(choices.map((choice) => [choice.kind, choice.templateId]))
  for (const current of projectTemplateChoices(appDb, projectDb)) {
    if (!wanted.has(current.kind)) resetTemplateOverrides(projectDb, current.kind, clock.now)
  }
  for (const [kind, templateId] of wanted) {
    if (getCurrentOverride(projectDb, kind)?.baseTemplateId === templateId) continue
    const template = getTemplate(appDb, templateId)
    if (template === null || template.kind !== kind) continue
    if (templateId === defaultTemplateId(appDb, kind)) {
      // Picking the default by id is the same as "Uses app default".
      if (getCurrentOverride(projectDb, kind) !== null) {
        resetTemplateOverrides(projectDb, kind, clock.now)
      }
      continue
    }
    insertTemplateOverride(projectDb, {
      id: `ovr-${clock.createId()}`,
      kind,
      baseTemplateId: template.id,
      body: template.body,
      hash: templateHash(template.body),
      settings: settingsOfRecord(template),
      createdAt: clock.now
    })
  }
}

/**
 * FR-10.4 "Copy settings from". The source project's current version of each step
 * becomes version 1 of that step in the new project. Older versions stay with the source.
 */
export function copyTemplateOverrides(
  from: SqliteDatabase,
  to: SqliteDatabase,
  clock: Clock
): void {
  for (const [kind, override] of listCurrentOverrides(from)) {
    insertTemplateOverride(to, {
      id: `ovr-${clock.createId()}`,
      kind,
      baseTemplateId: override.baseTemplateId,
      body: override.body,
      hash: override.hash,
      settings: override.settings,
      createdAt: clock.now
    })
  }
}
