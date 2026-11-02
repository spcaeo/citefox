import { PLANNED_TEMPLATE_KINDS } from '@shared/domain'

/**
 * Placeholder bodies and schemas for kinds registered ahead of the package that
 * writes them (Docs/PROMPT-AUDIT.md, P0). A planned kind is hidden from the
 * Templates screen and `loadGenerationTemplate` refuses to run it, so these are
 * never sent to Claude. The owning package replaces the body and the schema in
 * its own file and deletes the kind from `PLANNED_TEMPLATE_KINDS`.
 */

const PLACEHOLDER_LINE = 'Placeholder:'

/** `Template: <kind>.md`, then one line naming the package that writes the step. */
export function placeholderTemplateBody(kind: string): string {
  const owner = Object.prototype.hasOwnProperty.call(PLANNED_TEMPLATE_KINDS, kind)
    ? PLANNED_TEMPLATE_KINDS[kind]
    : 'a later package'
  return `Template: ${kind}.md
${PLACEHOLDER_LINE} package ${owner} of Docs/PROMPT-AUDIT.md writes this step. CiteFox does not run it yet.
Reply with JSON that matches the schema and no other text.
`
}

/** True for a body {@link placeholderTemplateBody} wrote. */
export function isPlaceholderTemplateBody(body: string): boolean {
  return body.split('\n', 2)[1]?.startsWith(PLACEHOLDER_LINE) === true
}

/** An empty object schema. Never used for a call: planned kinds do not run. */
export function placeholderSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: [], properties: {} }
}
