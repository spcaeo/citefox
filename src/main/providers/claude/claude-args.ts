import type { CommandResult } from '../command'
import { ProviderError } from '../errors'
import { classifyClaudeFailure } from './limits'

/**
 * Empty MCP map passed to `--mcp-config`.
 * https://code.claude.com/docs/en/mcp (`mcpServers`)
 * https://code.claude.com/docs/en/cli-reference (`--mcp-config` accepts a JSON string)
 */
export const EMPTY_MCP_CONFIG = '{"mcpServers":{}}'

/**
 * Oldest Claude Code that accepts both tool-restriction flags. Page text is
 * untrusted, so CiteFox never runs a CLI that cannot turn tools off.
 */
export const CLAUDE_CODE_MIN_VERSION = '2.1.0'

/**
 * Flags that turn tools off. A CLI that rejects one of these is not used:
 * the call fails with an update message instead of running with tools on.
 */
export const REQUIRED_RESTRICTION_FLAGS = ['--tools', '--disallowedTools'] as const

/**
 * Extra hardening. An older CLI that rejects one of these still runs with
 * tools off, minus only the flag it rejected.
 */
export const OPTIONAL_RESTRICTION_FLAGS = [
  '--strict-mcp-config',
  '--mcp-config',
  '--safe-mode',
  '--restricted',
  '--no-session-persistence'
] as const

export type RequiredRestrictionFlag = (typeof REQUIRED_RESTRICTION_FLAGS)[number]
export type OptionalRestrictionFlag = (typeof OPTIONAL_RESTRICTION_FLAGS)[number]
export type RestrictionFlag = RequiredRestrictionFlag | OptionalRestrictionFlag

/**
 * Turns for a call that passes `--json-schema`. Claude Code returns structured output
 * through a synthetic tool, which needs a follow-up turn; with one turn about a fifth of
 * first replies ended in `error_max_turns` with prose instead of JSON (live run, Oct 2026).
 * A deliberate deviation from LLM-3's single turn, for schema calls only: every tool
 * restriction still applies, so the second turn can only deliver the structured reply.
 */
export const STRUCTURED_MAX_TURNS = 2

/**
 * The only tools a web-search call may use (batch 2 row 5, competitors per product).
 * Both run on Anthropic's side or fetch a public page into the conversation; neither
 * can read, write or run anything on this computer.
 */
export const WEB_SEARCH_TOOLS = 'WebSearch,WebFetch'

/**
 * Turns for a web-search call: each search or fetch is a turn, then the JSON reply.
 * Twelve covers about ten lookups; the CLI ends the call there whatever the model asks.
 */
export const WEB_SEARCH_MAX_TURNS = 12

/** Per-call options for {@link claudePrintArgs}. */
export interface ClaudePrintOptions {
  /** Allow only WebSearch and WebFetch for this one call. Off for every other call. */
  webSearch?: boolean
}

/**
 * LLM-3 and LLM-4. One turn (two for a JSON-schema call, see `STRUCTURED_MAX_TURNS`),
 * tools off, JSON on stdout, `--model` always set.
 * The prompt is not an argument: `-p` with no positional prompt reads it from
 * stdin, which the transport writes and closes. `shell` stays false.
 *
 * Flags (https://code.claude.com/docs/en/cli-reference):
 * `--tools ""` disables built-in tools.
 * `--disallowedTools mcp__*` removes MCP tools, which `--tools` does not.
 * `--strict-mcp-config` keeps only `--mcp-config` (dropped together).
 * `--safe-mode` skips CLAUDE.md, skills, hooks, and MCP customizations; auth still works.
 * `--restricted` (CLI >= 2.1.248) loads only managed settings and `--settings`.
 * `--no-session-persistence` keeps page text out of saved session transcripts.
 * `--setting-sources` is not passed: an empty value is not a documented source
 * (`user`, `project`, `local`) and the CLI treats `""` as a missing value.
 *
 * `omit` lists optional flags this CLI rejected. Required flags are always sent.
 *
 * Web search (`options.webSearch`, batch 2 row 5): a deliberate, per-call exception to
 * LLM-3/LLM-4 for one step only, "which companies compete with this product", which
 * cannot be answered from the business's own pages. `--tools "WebSearch,WebFetch"` with
 * the same names in `--allowedTools` (print mode refuses a tool that needs permission
 * otherwise) and up to {@link WEB_SEARCH_MAX_TURNS} turns. Why this is safe:
 * - no tool can touch the machine: Bash, Edit, Write, Read and every other built-in tool
 *   stay off (`--tools` lists only the two), MCP tools stay removed (`--disallowedTools
 *   mcp__*`, strict empty MCP config), and `--restricted` drops code-running tools
 *   whatever settings say; `--safe-mode` skips CLAUDE.md, hooks and plugins;
 * - the prompt holds only the domain, a short product line and the market (written by a
 *   no-tools call from the page text), never raw page text and never a secret, so a
 *   fetched page has nothing private to leak;
 * - page text and search results are untrusted: the reply must be JSON in a fixed shape,
 *   is validated strictly, and every competitor domain is verified (DNS plus the brand on
 *   the homepage) before it is shown. Nothing in the reply is run or followed.
 */
export function claudePrintArgs(
  model: string,
  schema: Record<string, unknown> | null,
  omit: ReadonlySet<OptionalRestrictionFlag> = new Set(),
  options: ClaudePrintOptions = {}
): string[] {
  const web = options.webSearch === true
  const turns = web
    ? String(WEB_SEARCH_MAX_TURNS)
    : schema === null
      ? '1'
      : String(STRUCTURED_MAX_TURNS)
  const flags = ['-p', '--output-format', 'json', '--max-turns', turns, '--model', model]
  if (web) {
    flags.push('--tools', WEB_SEARCH_TOOLS, '--allowedTools', WEB_SEARCH_TOOLS)
    flags.push('--disallowedTools', 'mcp__*')
  } else {
    flags.push('--tools', '', '--disallowedTools', 'mcp__*')
  }
  if (!omit.has('--strict-mcp-config') && !omit.has('--mcp-config')) {
    flags.push('--strict-mcp-config', '--mcp-config', EMPTY_MCP_CONFIG)
  }
  if (!omit.has('--safe-mode')) flags.push('--safe-mode')
  if (!omit.has('--restricted')) flags.push('--restricted')
  if (!omit.has('--no-session-persistence')) flags.push('--no-session-persistence')
  if (schema !== null) flags.push('--json-schema', JSON.stringify(schema))
  assertNoAccountSwitch(flags)
  return flags
}

export function isRequiredRestrictionFlag(flag: RestrictionFlag): flag is RequiredRestrictionFlag {
  return (REQUIRED_RESTRICTION_FLAGS as readonly string[]).includes(flag)
}

const RESTRICTION_FLAG =
  '--(?:disallowedTools|disallowed-tools|strict-mcp-config|mcp-config|safe-mode|restricted|no-session-persistence|tools)'

/** Flag name cited by an unknown-option / invalid-argument error, or null. */
const REJECTED_FLAG = new RegExp(
  `(?:unknown|unrecognized|unexpected|illegal|invalid)\\s+(?:option|flag|argument)s?(?:\\s*[:=]\\s*|\\s+)['"\`]?(${RESTRICTION_FLAG})(?![\\w-])`,
  'i'
)

const MODEL_ERROR =
  /unknown model|invalid model|model not found|model_not_found|not a valid model|unsupported model/i

/**
 * A flag rejection is a non-zero exit whose stderr names one of our
 * restriction flags as an unknown option, before stdout has a JSON result.
 * Auth, plan limit, and model errors are left to the normal parser.
 */
export function rejectedRestrictionFlag(result: CommandResult): RestrictionFlag | null {
  if (result.timedOut || result.spawnError !== null) return null
  if (result.exitCode === null || result.exitCode === 0) return null
  if (stdoutHasJsonResult(result.stdout)) return null
  const text = `${result.stdout}\n${result.stderr}`
  if (classifyClaudeFailure(text) !== null || MODEL_ERROR.test(text)) return null
  const flag = REJECTED_FLAG.exec(result.stderr)?.[1]
  if (flag === undefined) return null
  return flag === '--disallowed-tools' ? '--disallowedTools' : (flag as RestrictionFlag)
}

function stdoutHasJsonResult(stdout: string): boolean {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

export function assertNoAccountSwitch(args: readonly string[]): void {
  for (const arg of args) {
    if (arg === 'login' || arg === 'logout' || arg === '--account' || arg === 'setup-token') {
      throw new ProviderError('CiteFox does not switch Claude subscription accounts', {
        code: 'validation',
        state: 'warning',
        nextStep: 'Use the one Claude Code login on this computer, or an Anthropic API key.'
      })
    }
  }
}
