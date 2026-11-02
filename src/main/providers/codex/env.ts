import { isBlockedClaudeEnv } from '../claude/env'

const BLOCKED_EXACT = new Set([
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'OPENAI_BASE_URL',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED'
])

/**
 * The child `codex` must use the ChatGPT login on this computer, never an API key
 * from the environment (which would bill that key), and must not get CiteFox's or
 * Claude's secrets either. `CODEX_HOME` is kept so a custom Codex folder still finds
 * its own login; CiteFox never reads that folder.
 */
export function scrubCodexEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (isBlockedCodexEnv(key)) continue
    next[key] = value
  }
  // No colour codes or terminal UI: the JSONL on stdout is all CiteFox reads.
  next.NO_COLOR = '1'
  return next
}

export function isBlockedCodexEnv(key: string): boolean {
  const upper = key.toUpperCase()
  if (BLOCKED_EXACT.has(upper)) return true
  if (isBlockedClaudeEnv(upper)) return true
  const aboutOpenAi = upper.includes('OPENAI') || upper.includes('CODEX')
  const sensitive =
    upper.includes('KEY') ||
    upper.includes('TOKEN') ||
    upper.includes('SECRET') ||
    upper.includes('OAUTH') ||
    upper.includes('PASSWORD')
  return aboutOpenAi && sensitive
}
