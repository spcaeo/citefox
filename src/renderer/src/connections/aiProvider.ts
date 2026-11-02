import type { AiCliProvider, ClaudeProvider } from '@shared/domain'
import type { ClaudeCheckupResult } from '@shared/ipc'
import { claudeModelLabel } from '../settings/modelLabel'

/**
 * Words for the AI program CiteFox runs on this computer: Claude Code or the OpenAI
 * Codex CLI (Docs/AI-PROVIDERS.md). Screens read these instead of saying "Claude"
 * when the AI doing the work is the chosen one.
 */
export interface AiCliCopy {
  provider: AiCliProvider
  /** "Claude Code" or "Codex". */
  program: string
  /** The AI's name in a sentence: "Claude" or "Codex". */
  ai: string
  /** What to run in Terminal to sign in: "claude" or "codex login". */
  loginCommand: string
  /** The program file name: "claude" or "codex". */
  binaryName: string
  /** "Claude plan" or "ChatGPT plan". */
  plan: string
  installUrl: string
  installLabel: string
  pathPlaceholder: string
}

const COPY: Readonly<Record<AiCliProvider, AiCliCopy>> = {
  'claude-code': {
    provider: 'claude-code',
    program: 'Claude Code',
    ai: 'Claude',
    loginCommand: 'claude',
    binaryName: 'claude',
    plan: 'Claude plan',
    installUrl: 'https://code.claude.com/docs',
    installLabel: 'How to install Claude Code',
    pathPlaceholder: '/usr/local/bin/claude'
  },
  codex: {
    provider: 'codex',
    program: 'Codex',
    ai: 'Codex',
    loginCommand: 'codex login',
    binaryName: 'codex',
    plan: 'ChatGPT plan',
    installUrl: 'https://developers.openai.com/codex/cli',
    installLabel: 'How to install Codex',
    pathPlaceholder: '/usr/local/bin/codex'
  }
}

export function aiCliCopy(provider: AiCliProvider): AiCliCopy {
  return COPY[provider]
}

/** The program a Settings choice runs. An Anthropic API key setting still checks Claude Code. */
export function cliProviderOf(provider: ClaudeProvider | null | undefined): AiCliProvider {
  return provider === 'codex' ? 'codex' : 'claude-code'
}

/** The program a stored checkup ran. Checkups saved before Codex existed were Claude Code. */
export function checkupProvider(checkup: ClaudeCheckupResult | null | undefined): AiCliProvider {
  return checkup?.provider === 'codex' ? 'codex' : 'claude-code'
}

/** The AI doing the work, for a sentence: "Claude", "Codex". */
export function aiName(provider: ClaudeProvider | null | undefined): string {
  return provider === 'codex' ? 'Codex' : 'Claude'
}

/** Shown while the Codex model settings are empty. */
export const DEFAULT_CODEX_MODEL_LABEL = 'Default (GPT-5.6 Terra)'
export const DEFAULT_CODEX_QUICK_MODEL_LABEL = 'Default (GPT-5.6 Luna)'

/** "Model · …" for the chosen program. */
export function aiModelLabel(
  provider: AiCliProvider,
  models: { claudeModel?: string | null; codexModel?: string | null }
): string {
  if (provider === 'codex') {
    const model = models.codexModel?.trim() ?? ''
    return model.length > 0 ? model : DEFAULT_CODEX_MODEL_LABEL
  }
  return claudeModelLabel(models.claudeModel)
}
