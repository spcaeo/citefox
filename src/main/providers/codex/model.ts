import type { ClaudeCompletionRequest } from '../claude/claude-code'

/**
 * Codex model for heavy jobs when Settings leaves `codexModel` null: check analysis,
 * reports, page reads, the Ask assistant and the competitor web search.
 * "Balanced model" in `codex debug models` with a ChatGPT login (codex-cli 0.149, Oct 2026).
 */
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-terra'

/**
 * Codex model for quick jobs when Settings leaves `codexQuickModel` null: form helpers,
 * short fills and the test call. "Fast and efficient model" in the same catalogue.
 */
export const DEFAULT_CODEX_QUICK_MODEL = 'gpt-5.6-luna'

export type CodexJobSize = 'quick' | 'heavy'

/** Reasoning effort per job size (`model_reasoning_effort`). Quick jobs answer in seconds. */
export const CODEX_REASONING_EFFORT: Readonly<Record<CodexJobSize, string>> = {
  quick: 'low',
  heavy: 'medium'
}

/** A prompt longer than this is a heavy job whatever asked for it (a page read, a report). */
export const CODEX_QUICK_PROMPT_CHARS = 8_000

/**
 * Heavy: web search, the check pipeline and reports, the Ask assistant, and any long
 * prompt. Quick: everything else (form helpers, help-fill, the test call).
 */
export function codexJobSize(request: ClaudeCompletionRequest): CodexJobSize {
  if (request.webSearch === true) return 'heavy'
  const source = request.trace?.source
  if (source === 'pipeline' || source === 'report' || source === 'ask') return 'heavy'
  return request.prompt.length > CODEX_QUICK_PROMPT_CHARS ? 'heavy' : 'quick'
}

/**
 * A request or project model meant for Claude ("claude-sonnet-5-5", "sonnet", "opus")
 * is not a Codex model, so it is ignored and the Codex setting applies.
 */
export function isClaudeModelId(model: string): boolean {
  return /^(?:claude|sonnet|opus|haiku|fable)\b/i.test(model.trim())
}

export interface CodexModelSettings {
  model?: string | null
  quickModel?: string | null
}

/** The model for one call: a Codex id on the request, else Settings by job size, else the default. */
export function resolveCodexModel(
  request: ClaudeCompletionRequest,
  settings: CodexModelSettings
): { model: string; size: CodexJobSize } {
  const size = codexJobSize(request)
  const asked = request.model ?? null
  if (asked !== null && asked.trim().length > 0 && !isClaudeModelId(asked)) {
    return { model: asked.trim(), size }
  }
  const saved = size === 'quick' ? settings.quickModel : settings.model
  if (saved !== null && saved !== undefined && saved.trim().length > 0) {
    return { model: saved.trim(), size }
  }
  return { model: size === 'quick' ? DEFAULT_CODEX_QUICK_MODEL : DEFAULT_CODEX_MODEL, size }
}
