import type { CommandResult } from '../command'
import { ProviderError } from '../errors'

/**
 * Codex features that would let the model touch this computer. These must be off:
 * a Codex that refuses to turn one off is not used (the call fails with an update
 * message), because page text is untrusted and CiteFox never gives it a shell.
 */
export const REQUIRED_DISABLED_FEATURES = ['shell_tool', 'unified_exec'] as const

/**
 * Everything else CiteFox turns off: connectors and plugins (MCP), sub-agents,
 * browser and computer use, image tools, hooks, memories and skills. A Codex build
 * that no longer knows one of these names ("Unknown feature flag") runs without that
 * one flag; the read-only sandbox and the two required flags still apply.
 */
export const OPTIONAL_DISABLED_FEATURES = [
  'apps',
  'plugins',
  'remote_plugin',
  'multi_agent',
  'view_image',
  'image_generation',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'goals',
  'tool_suggest',
  'hooks',
  'memories',
  'skill_search',
  'skill_mcp_dependency_install'
] as const

/**
 * Code mode runs tools from a script host. With the host off, code mode "fails
 * closed": no tool can run at all. Every call turns it off except a web-search call,
 * where Codex reaches its web search through that host (live run, Oct 2026). With the
 * shell, exec and connectors off and the sandbox read-only, the host can then only
 * search the web; a test asking it to list `/` or write a file got "no listing tool
 * available" and "writing is blocked by read-only sandbox".
 */
export const CODE_MODE_HOST_FEATURE = 'code_mode_host'

export type RequiredDisabledFeature = (typeof REQUIRED_DISABLED_FEATURES)[number]
export type OptionalDisabledFeature =
  (typeof OPTIONAL_DISABLED_FEATURES)[number] | typeof CODE_MODE_HOST_FEATURE

/** Per-call settings for {@link codexExecArgs}. */
export interface CodexExecCall {
  model: string
  /** `model_reasoning_effort`: low for quick jobs, medium for heavy ones. */
  effort: string
  /** A strict JSON Schema file for `--output-schema`, or null for a text reply. */
  schemaPath: string | null
  /** Live web search for this one call (competitors per product). Off otherwise. */
  webSearch: boolean
}

/**
 * One locked-down, non-interactive Codex run (`codex exec`, codex-cli 0.149):
 * - `--json`: events as JSONL on stdout, the only thing CiteFox reads;
 * - `--ephemeral`: no session files, so page text is not saved to disk;
 * - `--ignore-user-config` and `--ignore-rules`: no `~/.codex/config.toml` (its MCP
 *   servers, profiles and model) and no exec-policy rules; the ChatGPT login still works;
 * - `--sandbox read-only` and `approval_policy="never"`: nothing may be written, and
 *   nothing waits for a person to approve it;
 * - `--skip-git-repo-check`: the run happens in an empty temp folder (the transport's cwd);
 * - `web_search="disabled"` except a web-search call (`"live"`);
 * - the `include_*` and `skills.include_instructions` switches keep the user's skills,
 *   AGENTS.md, connectors and environment out of the prompt; an empty `mcp_servers`
 *   table and `project_doc_max_bytes=0` make sure of it;
 * - the shell, exec, connectors and every other tool listed above are disabled;
 * - the prompt is not an argument: `-` reads it from stdin, which the transport writes
 *   and closes. `shell` stays false.
 * `omit` lists optional features this Codex did not recognise.
 */
export function codexExecArgs(
  call: CodexExecCall,
  omit: ReadonlySet<OptionalDisabledFeature> = new Set()
): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '--model',
    call.model,
    '-c',
    `model_reasoning_effort="${call.effort}"`,
    '-c',
    'approval_policy="never"',
    '-c',
    `web_search="${call.webSearch ? 'live' : 'disabled'}"`,
    '-c',
    'skills.include_instructions=false',
    '-c',
    'include_apps_instructions=false',
    '-c',
    'include_environment_context=false',
    '-c',
    'include_permissions_instructions=false',
    '-c',
    'include_collaboration_mode_instructions=false',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'mcp_servers={}'
  ]
  for (const feature of REQUIRED_DISABLED_FEATURES) args.push('--disable', feature)
  for (const feature of OPTIONAL_DISABLED_FEATURES) {
    if (!omit.has(feature)) args.push('--disable', feature)
  }
  if (!call.webSearch && !omit.has(CODE_MODE_HOST_FEATURE)) {
    args.push('--disable', CODE_MODE_HOST_FEATURE)
  }
  if (call.schemaPath !== null) args.push('--output-schema', call.schemaPath)
  args.push('-')
  assertNoCodexAccountChange(args)
  return args
}

const UNKNOWN_FEATURE = /unknown feature(?: flag)?:?\s*['"`]?([a-z0-9_]+)/i

/** The feature a run refused as unknown, before any event was written, or null. */
export function rejectedCodexFeature(result: CommandResult): string | null {
  if (result.timedOut || result.spawnError !== null) return null
  if (result.exitCode === null || result.exitCode === 0) return null
  if (result.stdout.includes('"type":"thread.started"')) return null
  return UNKNOWN_FEATURE.exec(`${result.stderr}\n${result.stdout}`)?.[1] ?? null
}

const UNEXPECTED_ARGUMENT = /unexpected argument ['"`]?(--?[a-z0-9-]+)/i

/** A flag this Codex is too old to know ("unexpected argument '--ignore-rules'"), or null. */
export function rejectedCodexArgument(result: CommandResult): string | null {
  if (result.timedOut || result.spawnError !== null) return null
  if (result.exitCode === null || result.exitCode === 0) return null
  if (result.stdout.includes('"type":"thread.started"')) return null
  return UNEXPECTED_ARGUMENT.exec(result.stderr)?.[1] ?? null
}

export function isOptionalDisabledFeature(name: string): name is OptionalDisabledFeature {
  return (
    name === CODE_MODE_HOST_FEATURE ||
    (OPTIONAL_DISABLED_FEATURES as readonly string[]).includes(name)
  )
}

/** CiteFox uses the one Codex sign-in on this computer and never changes it. */
export function assertNoCodexAccountChange(args: readonly string[]): void {
  for (const arg of args) {
    if (arg === 'login' || arg === 'logout' || arg === '--with-api-key' || arg === '--api-key') {
      if (args[0] === 'login' && args[1] === 'status' && args.length === 2) continue
      throw new ProviderError('CiteFox does not change the Codex sign-in', {
        code: 'validation',
        state: 'warning',
        nextStep: 'Use the one Codex sign-in on this computer.'
      })
    }
  }
}
