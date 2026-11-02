#!/usr/bin/env node
/**
 * A stand-in `claude` program for testing how CiteFox behaves when Claude stops
 * partway through a job. Point Settings › Claude binary path at
 * scripts/fake-claude/claude (a small shell file that runs this script).
 *
 * Every call goes to the real `claude` until the trigger, then the fake answers
 * exactly the way Claude Code does for the chosen failure. See
 * Docs/TESTING-CLAUDE-FAILURES.md.
 *
 * Settings, read on every call (environment variables win over the file):
 *   FAKE_CLAUDE_MODE   pass | session_limit | weekly_limit | legacy_limit | signed_out |
 *                      plan_inactive | api_credit_low | overloaded | timeout | malformed
 *   FAKE_CLAUDE_AFTER  pass N print calls through, then fail (default 0)
 *   FAKE_CLAUDE_RESET_MINUTES  limit modes: the limit resets this many minutes after it
 *                      first hits; after that the fake passes calls through again
 *   FAKE_CLAUDE_ZONE   the zone named in "resets 7:30pm (America/Toronto)" (default: this computer's)
 *   FAKE_CLAUDE_REAL   the real claude program (default: found on PATH and the usual folders)
 *   FAKE_CLAUDE_SLEEP_MS  timeout mode: how long to hang (default 15 minutes)
 *   FAKE_CLAUDE_TEXT   replace the failure sentence (to try another wording)
 *   FAKE_CLAUDE_STATE  where the call count is kept (default: .fake-claude-state.json here)
 * The file is scripts/fake-claude.json, for example {"mode":"weekly_limit","after":3}.
 *
 * Own commands (never sent to Claude):
 *   node scripts/fake-claude.mjs --fake-reset    start counting again
 *   node scripts/fake-claude.mjs --fake-status   show the settings and the count
 *
 * It never reads, prints or stores a key or a prompt.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHIM = join(HERE, 'fake-claude', 'claude')
const FALLBACK_VERSION = '2.1.312 (Claude Code)'

export const MODES = [
  'pass',
  'session_limit',
  'weekly_limit',
  'legacy_limit',
  'signed_out',
  'plan_inactive',
  'api_credit_low',
  'overloaded',
  'timeout',
  'malformed'
]
const LIMIT_MODES = new Set(['session_limit', 'weekly_limit', 'legacy_limit'])

function readConfig(env = process.env) {
  let file = {}
  try {
    file = JSON.parse(readFileSync(join(HERE, 'fake-claude.json'), 'utf8'))
  } catch {
    file = {}
  }
  const pick = (name, key) => env[name] ?? (file[key] === undefined ? undefined : String(file[key]))
  const mode = pick('FAKE_CLAUDE_MODE', 'mode') ?? 'pass'
  return {
    mode: MODES.includes(mode) ? mode : 'pass',
    after: Math.max(0, Number.parseInt(pick('FAKE_CLAUDE_AFTER', 'after') ?? '0', 10) || 0),
    resetMinutes: numberOrNull(pick('FAKE_CLAUDE_RESET_MINUTES', 'resetMinutes')),
    zone: pick('FAKE_CLAUDE_ZONE', 'zone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    real: pick('FAKE_CLAUDE_REAL', 'real') ?? null,
    sleepMs: numberOrNull(pick('FAKE_CLAUDE_SLEEP_MS', 'sleepMs')) ?? 15 * 60_000,
    text: pick('FAKE_CLAUDE_TEXT', 'text') ?? null,
    statePath: pick('FAKE_CLAUDE_STATE', 'state') ?? join(HERE, '.fake-claude-state.json')
  }
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'))
    return { prints: Number(state.prints) || 0, resetsAt: numberOrNull(state.resetsAt) }
  } catch {
    return { prints: 0, resetsAt: null }
  }
}

function writeState(path, state) {
  try {
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
  } catch {
    // A read-only folder: the count starts again next call. Not worth failing for.
  }
}

/** The real `claude`, never this fake (its folder may be on PATH too). */
function findRealClaude(configured) {
  const own = safeRealpath(SHIM)
  const candidates = []
  if (configured) candidates.push(configured)
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (folder) candidates.push(join(folder, 'claude'))
  }
  const home = homedir()
  candidates.push(
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  )
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    const real = safeRealpath(candidate)
    if (real !== null && real !== own && !real.endsWith('fake-claude.mjs')) return candidate
  }
  return null
}

function safeRealpath(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function passThrough(real, args) {
  if (real === null) {
    process.stderr.write(
      'fake-claude: the real claude was not found. Set FAKE_CLAUDE_REAL to its full path.\n'
    )
    process.exit(127)
  }
  const child = spawn(real, args, { stdio: 'inherit' })
  child.on('error', (error) => {
    process.stderr.write(
      `fake-claude: could not start the real claude (${error.code ?? 'error'}).\n`
    )
    process.exit(127)
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

/** "7:30pm", "3pm", or "Nov 2, 9am" past a day away: Claude Code's own reset wording. */
export function claudeResetWords(at, now, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  )
  const minutes = parts.minute === '00' ? '' : `:${parts.minute}`
  const time = `${parts.hour}${minutes}${String(parts.dayPeriod).toLowerCase()}`
  const far = at.getTime() - now.getTime() > 24 * 60 * 60_000
  return `${far ? `${parts.month} ${parts.day}, ` : ''}${time} (${zone})`
}

function defaultResetAt(mode, now) {
  if (mode === 'weekly_limit') {
    const at = new Date(now.getTime() + 3 * 24 * 60 * 60_000)
    at.setMinutes(0, 0, 0)
    return at.getTime()
  }
  // A session (5-hour) window: about two hours left, on the hour.
  const at = new Date(now.getTime() + 2 * 60 * 60_000)
  at.setMinutes(0, 0, 0)
  return at.getTime()
}

function failureText(config, resetsAt, now) {
  if (config.text !== null) return config.text
  switch (config.mode) {
    case 'session_limit':
      return `You've hit your session limit · resets ${claudeResetWords(new Date(resetsAt), now, config.zone)}`
    case 'weekly_limit':
      return `You've hit your weekly limit · resets ${claudeResetWords(new Date(resetsAt), now, config.zone)}`
    case 'legacy_limit':
      return `Claude AI usage limit reached|${Math.floor(resetsAt / 1000)}`
    case 'signed_out':
      return 'Not logged in · Please run /login'
    case 'plan_inactive':
      return 'Your Claude subscription has expired. Renew your plan at claude.ai to keep using Claude Code.'
    case 'api_credit_low':
      return 'Credit balance is too low'
    case 'overloaded':
      return 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":null}'
    default:
      return 'Claude Code did not complete the call.'
  }
}

const API_STATUS = {
  session_limit: 429,
  weekly_limit: 429,
  legacy_limit: 429,
  signed_out: 401,
  plan_inactive: 403,
  api_credit_low: 400,
  overloaded: 529
}

/** `claude -p --output-format json` for a call that failed: exit 1, the JSON on stdout. */
function printFailure(config, text) {
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    api_error_status: API_STATUS[config.mode] ?? null,
    duration_ms: 212,
    duration_api_ms: 0,
    num_turns: 1,
    result: text,
    stop_reason: 'stop_sequence',
    session_id: randomUUID(),
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard'
    },
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID()
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(1)
}

/** `claude auth status --json` as each failure would show it. */
function authStatus(mode) {
  if (mode === 'signed_out') {
    process.stdout.write(
      `${JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, null, 2)}\n`
    )
    process.exit(1)
  }
  const status =
    mode === 'api_credit_low'
      ? {
          loggedIn: true,
          authMethod: 'api_key',
          apiProvider: 'firstParty',
          apiKeySource: 'apiKeyHelper'
        }
      : mode === 'plan_inactive'
        ? {
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType: null
          }
        : {
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType: 'max'
          }
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
  process.exit(0)
}

function isPrint(args) {
  return args.includes('-p') || args.includes('--print')
}

function isAuthStatus(args) {
  return args[0] === 'auth' && args[1] === 'status'
}

function main() {
  const args = process.argv.slice(2)
  const config = readConfig()
  if (args[0] === '--fake-reset') {
    writeState(config.statePath, { prints: 0, resetsAt: null })
    process.stdout.write('fake-claude: count reset.\n')
    return
  }
  if (args[0] === '--fake-status') {
    const state = readState(config.statePath)
    const shown = { ...config, ...state, real: findRealClaude(config.real) }
    delete shown.statePath
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`)
    return
  }
  const real = findRealClaude(config.real)
  if (args[0] === '--version' || args[0] === '-v') {
    if (real !== null) return passThrough(real, args)
    process.stdout.write(`${FALLBACK_VERSION}\n`)
    return
  }
  const now = new Date()
  const state = readState(config.statePath)
  // A limit that has reset: Claude works again, as the real one would.
  const limitOver =
    LIMIT_MODES.has(config.mode) && state.resetsAt !== null && state.resetsAt <= now.getTime()
  const triggered = config.mode !== 'pass' && !limitOver && state.prints >= config.after
  if (isAuthStatus(args)) {
    if (triggered) return authStatus(config.mode)
    return passThrough(real, args)
  }
  if (!isPrint(args)) return passThrough(real, args)
  if (!triggered) {
    writeState(config.statePath, { ...state, prints: state.prints + 1 })
    return passThrough(real, args)
  }
  let resetsAt = state.resetsAt
  if (LIMIT_MODES.has(config.mode) && resetsAt === null) {
    resetsAt =
      config.resetMinutes === null
        ? defaultResetAt(config.mode, now)
        : now.getTime() + config.resetMinutes * 60_000
  }
  writeState(config.statePath, { prints: state.prints + 1, resetsAt })
  if (config.mode === 'timeout') {
    // Hang past CiteFox's limit; CiteFox kills the whole process group.
    setTimeout(() => process.exit(1), config.sleepMs)
    process.stdin.resume()
    return
  }
  if (config.mode === 'malformed') {
    process.stdout.write(
      '{"type":"result","subtype":"success","is_error":false,"result":"{\\"ok\\":'
    )
    process.exit(0)
  }
  printFailure(config, failureText(config, resetsAt ?? now.getTime(), now))
}

main()
