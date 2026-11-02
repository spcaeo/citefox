import type {
  HelpFillEstimate,
  SetupSectionEstimateRequest,
  SetupSectionPrompt,
  SetupSectionReadRequest,
  SetupSectionRequest,
  SetupSectionResult,
  SetupSectionRunRequest
} from '@shared/ipc'
import { connectionOf } from '../../assist/label'
import { progressNote } from '../../assist/progress'
import {
  claudePausedReason,
  planProjectClaude,
  projectClaudeModel,
  resolveClaude
} from '../../engine/claude'
import type { EngineHost } from '../../engine/host'
import { openOwned } from '../../engine/project-db'
import { IpcRequestError } from '../../ipc-request'
import { REDACTED_PROMPT } from '../../logging/redact'
import { PipelineError } from '../../pipeline/errors'
import { PROJECT_RULES_HEAD, projectRulesBlock } from '../../prompts/project-rules'
import { ProviderError } from '../../providers/errors'
import { lastOkCallOn } from '../../storage/llm-calls'
import { activeProjectRules } from '../../storage/project-rules'
import { getLatestClaudeCheckup, listProjects } from '../../storage/records'
import { knownOutline, siteOutlineFor } from '../../engine/site-outline'
import { editedTask, promptResult, runPrompt, sectionTask, type SectionPromptInput } from './prompt'
import { sectionAssistId, sectionDef } from './registry'
import { settleReply } from './settle'
import type { SectionDef } from './types'

/**
 * `onboarding:section*` (Docs/ONBOARDING.md): the onboarding v2 section cards.
 *
 * - Estimate reads the Claude connection and never calls Claude (the same logic as
 *   `helpfill:setupEstimate`): `available: false` with a plain reason when Claude is
 *   not set up, so every ✦ action turns into "use your own ChatGPT".
 * - Prompt builds the exact prompt a run would send (without its routing line).
 * - Run sends it (the user's edited prompt replaces the task part; main adds the reply
 *   rules), one Claude call, web search for competitors only, then reads the reply.
 * - Read reads a chatbot answer pasted back, the same way.
 *
 * Nothing is saved. Prompts, replies and page text are never written to the log.
 */

/** The project steps 7 and 8 work on, once step 6 saved the profile; else Settings'. */
function setupProjectId(host: EngineHost): string | null {
  return listProjects(host.storage.db)[0]?.id ?? null
}

export const NO_CLAUDE_REASON = 'CiteFox AI is not set up. Use your own ChatGPT for this section.'

export function estimateSection(
  host: EngineHost,
  request: SetupSectionEstimateRequest
): HelpFillEstimate {
  const def = sectionDef(request.section)
  const projectId = setupProjectId(host)
  const callText = def.webSearch ? '1 AI call with web search' : '1 AI call'
  if (!claudeReady(host, projectId)) {
    return {
      kind: def.id,
      available: false,
      calls: 1,
      costText: callText,
      reason: NO_CLAUDE_REASON
    }
  }
  // A limit paused Claude Code: say when it resets, and let ✦ go the ChatGPT way.
  const paused = claudePausedReason(host, projectId)
  if (paused !== null) {
    return { kind: def.id, available: false, calls: 1, costText: callText, reason: paused }
  }
  const onPlan = connectionOf(host, projectId) === 'claude-code'
  return {
    kind: def.id,
    available: true,
    calls: 1,
    costText: onPlan
      ? `${callText} · on your AI plan`
      : `${callText} · about $${def.usd.toFixed(2)}`,
    reason: null
  }
}

/**
 * True when a ✦ run can go: an Anthropic API key is chosen, or Claude Code (or Codex) is
 * chosen and either its last checkup got a reply or a real call on it got one since that
 * checkup (setup's site read can run Claude without a checkup, so a missing checkup
 * must not hide ✦). Step 2's "No Claude? Skip" leaves neither, so every ✦ action
 * becomes the user's own ChatGPT instead of a call that fails.
 */
export function claudeReady(host: EngineHost, projectId: string | null): boolean {
  if (host.claude !== undefined) return true
  const connection = planProjectClaude(host.storage, host.settings(), projectId).connection
  if (connection === null) return false
  if (connection.kind === 'api-key') return true
  const checkup = getLatestClaudeCheckup(host.storage.db)
  if (checkup?.roundTripOk === true) return true
  const lastOk = lastOkCallOn(host.storage.db, connection.kind)
  return lastOk !== null && (checkup === null || lastOk > checkup.ranAt)
}

export async function promptSection(
  host: EngineHost,
  request: SetupSectionRequest
): Promise<SetupSectionPrompt> {
  const def = sectionDef(request.section)
  const input = await withSite(host, def, request)
  return promptResult(def, sectionTask(def, input, host.knownSecrets()))
}

/** A pasted chatbot answer, checked against the site read this session made (no new read). */
export function readSection(
  host: EngineHost,
  request: SetupSectionReadRequest
): SetupSectionResult {
  const def = sectionDef(request.section)
  const site = def.site === undefined ? null : knownOutline(host, request.context.domain)
  return settleReply(def, request.context, request.current, request.text, 'paste', site)
}

/**
 * The request with the site digest for a section that lists it (`def.site`): the step 3
 * read when this run made one, else one read of the home page. A site that cannot be
 * read leaves it out; the prompt still works without, and the code checks stay off.
 */
async function withSite<T extends SetupSectionRequest>(
  host: EngineHost,
  def: SectionDef,
  request: T
): Promise<T & SectionPromptInput> {
  const rules = setupRules(host, request.rules ?? [])
  if (def.site === undefined) return { ...request, rules }
  return { ...request, rules, site: await siteOutlineFor(host, request.context.domain) }
}

/**
 * The owner's rules for a setup prompt: the ones the setup project already saved
 * (Project settings › Project rules), then the draft's, each once.
 */
function setupRules(host: EngineHost, draft: readonly string[]): string[] {
  const projectId = setupProjectId(host)
  let saved: string[] = []
  if (projectId !== null) {
    try {
      const opened = openOwned(host, projectId, 'onboarding:sectionRun')
      try {
        saved = activeProjectRules(opened.db)
      } finally {
        opened.close()
      }
    } catch {
      saved = []
    }
  }
  const seen = new Set<string>()
  return [...saved, ...draft].filter((rule) => {
    const key = rule.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function runSection(
  host: EngineHost,
  request: SetupSectionRunRequest
): Promise<SetupSectionResult> {
  const channel = 'onboarding:sectionRun'
  const def = sectionDef(request.section)
  const withSiteRequest = await withSite(host, def, request)
  const task = taskFor(host, def, withSiteRequest)
  if (task.trim().length === 0) {
    throw new IpcRequestError(
      channel,
      'The prompt is empty.',
      'Reset it, or write what Claude should do.'
    )
  }
  const projectId = setupProjectId(host)
  const provider = resolveClaude(host, channel, projectId)
  const prompt = runPrompt(def, task)
  host.logger.info('setup section run', {
    section: def.id,
    mode: request.mode,
    edited: request.prompt !== null,
    instruction: request.instruction !== null,
    prompt: REDACTED_PROMPT,
    promptLength: prompt.length
  })
  let text: string
  try {
    const completion = await provider.complete({
      prompt,
      schema: null,
      model: projectClaudeModel(host, projectId),
      maxTokens: def.webSearch ? 8000 : 3000,
      ...(def.webSearch ? { webSearch: true } : {}),
      progress: {
        label: `${request.mode === 'more' ? 'Finding more' : 'Redoing'} ${def.noun[1]}`,
        detail: def.webSearch ? 'Web search on for this step only' : 'One Claude call'
      },
      trace: {
        source: 'assist',
        projectId,
        assistId: sectionAssistId(def.id),
        templateKind: null,
        templateId: null,
        templateHash: null
      }
    })
    text = completion.text
  } catch (error) {
    if (def.webSearch && timedOut(error)) {
      // A web search that runs out of time keeps what the section holds: a plain note, no error.
      host.logger.warn('setup section web search timed out', { section: def.id })
      progressNote({ kind: 'result', label: 'The web search took too long', state: 'done' })
      return { section: def.id, rows: [], text: null, warnings: [WEB_SEARCH_TIMEOUT] }
    }
    const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
    progressNote({ kind: 'result', label: `Could not get ${def.noun[1]}`, state: 'failed' })
    throw new PipelineError(message, {
      code: 'fetch_failed',
      nextStep:
        error instanceof ProviderError && error.nextStep
          ? error.nextStep
          : 'Try again, or use your own ChatGPT for this section.',
      secrets: host.knownSecrets()
    })
  }
  const site = withSiteRequest.site ?? null
  const result = settleReply(def, request.context, request.current, text, 'run', site)
  // Counts only: never the prompt, the reply or a row.
  host.logger.info('setup section read', {
    section: def.id,
    rows: result.rows.length,
    text: result.text === null ? 0 : result.text.length,
    warnings: result.warnings.length
  })
  // The activity panel counts a run as finished only on its result step.
  const found = result.text !== null ? 1 : result.rows.length
  progressNote({
    kind: 'result',
    label:
      found === 0
        ? `No new ${def.noun[1]}`
        : result.text !== null
          ? 'Text ready'
          : `${found} ${found === 1 ? def.noun[0] : def.noun[1]} ready`,
    detail: 'Nothing is saved until you continue',
    state: 'done'
  })
  return result
}

export const WEB_SEARCH_TIMEOUT =
  'The web search took too long, so no new competitors came back. Your list is unchanged. Try again, or use your own ChatGPT.'

/** An edited prompt keeps the owner's rules: added at its end when the user cut them. */
function withRules(task: string, rules: readonly string[]): string {
  const block = projectRulesBlock(rules)
  if (block.length === 0 || task.includes(PROJECT_RULES_HEAD)) return task
  return `${task}\n\n${block}`
}

function timedOut(error: unknown): boolean {
  if (error instanceof ProviderError) return error.code === 'timeout'
  return error instanceof Error && /timed out|timeout/iu.test(error.message)
}

/** The default task, or the user's edited one with their new words added when missing. */
function taskFor(
  host: EngineHost,
  def: SectionDef,
  request: SetupSectionRunRequest & SectionPromptInput
): string {
  const secrets = host.knownSecrets()
  if (request.prompt === null) return sectionTask(def, request, secrets)
  const edited = withRules(editedTask(request.prompt, secrets), request.rules ?? [])
  const instruction = request.instruction
  if (instruction === null || edited.includes(instruction)) return edited
  return `${edited}\n\nThe user asks for this: ${instruction}`
}
