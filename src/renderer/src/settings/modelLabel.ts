/**
 * Label for `claudeModel` while it is null.
 * A later `resolvedModel` on the checkup result will replace this with the real model id.
 */
export const DEFAULT_CLAUDE_MODEL_LABEL = 'Default (Sonnet)'

export function claudeModelLabel(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : DEFAULT_CLAUDE_MODEL_LABEL
}
