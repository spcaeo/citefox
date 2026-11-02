import type { ClaudeProvider, JinaMode } from '@shared/domain'
import type { AiContextPatch } from '../assistant/context/types'
import { claudeModelLabel } from './modelLabel'
import {
  DEFAULT_CODEX_MODEL_LABEL,
  DEFAULT_CODEX_QUICK_MODEL_LABEL
} from '../connections/aiProvider'
import { SETTINGS_TABS, type SettingsTab } from './tabs'
import type { SettingsDraft } from './validate'

const PROVIDER: Readonly<Record<ClaudeProvider, string>> = {
  'claude-code': 'Claude Code',
  'anthropic-api': 'Anthropic API',
  codex: 'Codex'
}

const JINA: Readonly<Record<JinaMode, string>> = {
  fallback: 'only when a page fetch fails',
  always: 'always',
  never: 'never'
}

/**
 * What Ask CiteFox knows about app Settings: the open tab and the values the
 * form shows, as short facts. Never the user's name or a binary path.
 */
export function settingsAiPatch(input: {
  tab: SettingsTab
  draft: SettingsDraft
  /** The form differs from what is saved. */
  unsaved: boolean
  serpKeys: number
}): AiContextPatch {
  const { draft } = input
  const budget = draft.budget.trim()
  const facts = [
    draft.claudeProvider === 'codex'
      ? `AI: Codex · model ${draft.codexModel.trim() || DEFAULT_CODEX_MODEL_LABEL} · quick model ${draft.codexQuickModel.trim() || DEFAULT_CODEX_QUICK_MODEL_LABEL} · ${draft.claudeConcurrency} at a time`
      : `Claude: ${PROVIDER[draft.claudeProvider]} · model ${claudeModelLabel(draft.claudeModel)} · ${draft.claudeConcurrency} at a time`,
    `Monthly search budget: ${budget === '' ? 'no cap' : budget}`,
    `SerpApi keys: ${input.serpKeys}`,
    `Jina Reader: ${JINA[draft.jinaMode]}`,
    `Default market: ${[draft.defaultCountry, draft.defaultLanguage, draft.defaultDevice].filter(Boolean).join(' · ')}`,
    `Default re-check: every ${draft.defaultIntervalDays} days · ${draft.defaultSamples} samples · ${draft.defaultPromptCount} questions`
  ]
  if (input.unsaved) facts.push('Unsaved changes')
  return {
    filters: { tab: SETTINGS_TABS.find((item) => item.id === input.tab)?.label ?? input.tab },
    facts
  }
}
