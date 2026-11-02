const BLOCKED_EXACT = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN'
])

/**
 * LLM-6. A child `claude` process must not inherit an API key, or headless
 * calls bill that key instead of the subscription. LLM-2: OAuth tokens are
 * not forwarded either. LLM-9: nothing here selects a different account.
 */
export function scrubClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (isBlockedClaudeEnv(key)) continue
    next[key] = value
  }
  return next
}

export function isBlockedClaudeEnv(key: string): boolean {
  const upper = key.toUpperCase()
  if (BLOCKED_EXACT.has(upper)) return true
  const aboutClaude = upper.includes('ANTHROPIC') || upper.includes('CLAUDE')
  const sensitive =
    upper.includes('KEY') ||
    upper.includes('TOKEN') ||
    upper.includes('SECRET') ||
    upper.includes('OAUTH') ||
    upper.includes('PASSWORD')
  return aboutClaude && sensitive
}
