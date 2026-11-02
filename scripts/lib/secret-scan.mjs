// A small built-in secret scan for when gitleaks is not installed.
// Used by the pre-commit hook (scripts/hooks/secret-scan.mjs) and as a second
// pass in scripts/public-sync.mjs. gitleaks (.gitleaks.toml) stays the real
// check; this catches the common key formats so a commit is never unguarded.
// Findings never carry the full value: only the first 4 characters.

/** Known key formats. Each `re` must have the value as its whole match or group 1. */
export const KEY_PATTERNS = [
  { rule: 'anthropic-key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/, mixed: true },
  {
    rule: 'openai-key',
    re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/,
    mixed: true
  },
  { rule: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    rule: 'github-token',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/
  },
  { rule: 'slack-token', re: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
  {
    rule: 'slack-webhook',
    re: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/
  },
  { rule: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'jina-key', re: /\bjina_[A-Za-z0-9]{40,}/ },
  { rule: 'stripe-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { rule: 'private-key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/ }
]

/** NAME = "value" in code, where NAME says key, token, secret or password. */
const QUOTED_ASSIGNMENT =
  /([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|apikey)[A-Za-z0-9_]*)['"]?\s*[:=]\s*(['"`])([^'"`\s]{16,})\2/i
/** NAME=value in .env files and shell. */
const ENV_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s#'"]{16,})\s*$/

/** Values that say they are not real, or are names of keychain items. Same idea as .gitleaks.toml. */
const ALLOWED_VALUE = [
  /fake|planted|fixture|dummy|placeholder|not-?a-?real|redacted|example|changeme|your[-_]/i,
  /^test[-_]/i,
  /abcdef|0123456|123456789/i,
  /^citefox\.[a-z0-9]+\.[A-Za-z0-9._-]+$/,
  /^(?:x+|\*+|0+|\.+)$/i,
  /\$\{|process\.env|import\.meta|^\$[A-Z_]/
]

/** A line can opt out with this marker (same marker gitleaks honours). */
const INLINE_ALLOW = /gitleaks:allow/

/** Shannon entropy in bits per character. */
export function entropy(value) {
  const counts = new Map()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) {
    const p = n / value.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** The first 4 characters and the length, never the whole value. */
export function maskSecret(value) {
  return `${value.slice(0, 4)}… (${value.length} chars)`
}

function allowed(value) {
  return ALLOWED_VALUE.some((re) => re.test(value))
}

/** Made of short words and ids (`slack:proj-1:check-1`, `sk-ant-client-secret-0001`), not a key. */
function wordy(value) {
  const parts = value.split(/[-_.:=@|]/)
  return parts.length >= 3 && parts.every((part) => part.length <= 12)
}

/**
 * Scans one line. Returns `{ rule, preview }` findings; `preview` is masked.
 * @param {string} line
 */
export function scanLine(line) {
  if (INLINE_ALLOW.test(line)) return []
  const found = []
  for (const { rule, re, mixed } of KEY_PATTERNS) {
    const match = re.exec(line)
    if (!match) continue
    const value = match[1] ?? match[0]
    if (rule !== 'private-key' && allowed(value)) continue
    // Real keys of these kinds mix upper case, lower case and digits.
    if (mixed && !(/[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value))) continue
    found.push({ rule, preview: maskSecret(value) })
  }
  if (found.length > 0) return found
  for (const re of [QUOTED_ASSIGNMENT, ENV_ASSIGNMENT]) {
    const match = re.exec(line)
    if (!match) continue
    const value = re === QUOTED_ASSIGNMENT ? match[3] : match[2]
    if (allowed(value)) continue
    // Words, paths and URLs are not keys: ask for a mix of characters and high entropy.
    if (/[/\\]/.test(value) || wordy(value) || !/\d/.test(value) || !/[a-z]/i.test(value)) continue
    if (entropy(value) < 3.5) continue
    found.push({ rule: 'high-entropy-assignment', preview: maskSecret(value) })
  }
  return found
}

/**
 * Scans text. Returns `{ line, rule, preview }` with 1-based line numbers.
 * @param {string} text
 */
export function scanText(text) {
  const out = []
  text.split(/\r?\n/).forEach((line, index) => {
    for (const finding of scanLine(line)) out.push({ line: index + 1, ...finding })
  })
  return out
}

/**
 * Scans the added lines of a unified diff (`git diff --cached -U0`).
 * Returns `{ file, line, rule, preview }`.
 * @param {string} diff
 */
export function scanDiff(diff) {
  const out = []
  let file = null
  let lineNo = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.replace(/^\+\+\+ (?:b\/)?/, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      lineNo = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+') && file) {
      for (const finding of scanLine(raw.slice(1))) out.push({ file, line: lineNo, ...finding })
      lineNo += 1
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      lineNo += 1
    }
  }
  return out
}
