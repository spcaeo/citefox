import { randomUUID } from 'node:crypto'
import type { AssistDescription, AssistResult, AssistRunRequest } from '@shared/ipc'
import { projectClaudeModel, resolveClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { redactString } from '../logging/redact'
import { PipelineError } from '../pipeline/errors'
import { ProviderError } from '../providers/errors'
import type { SqliteDatabase } from '../storage/database'
import { projectDatabasePool } from '../storage/project-db-pool'
import { activeProjectRules } from '../storage/project-rules'
import { getProject } from '../storage/records'
import { assistLabel, connectionOf, expectedSeconds } from './label'
import { assistPrompt } from './preamble'
import { webAssistPrompt } from './web-prompt'
import { progressHint, progressNote, progressRetryNext, progressStep } from './progress'
import { hasAssistPurpose } from './progress-labels'
import { getAssist } from './registry'
import { ASSIST_REPLY_SCHEMA, readAssistReply } from './reply'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from './types'

/** Model requests one assist may make: the reply and one retry with the problem named. */
const ASSIST_ATTEMPTS = 2

/** `assist:describe`. Reads `llm_calls` only; never calls Claude. */
export function describeAssist(
  host: EngineHost,
  request: { assistId: string; projectId: string | null },
  channel = 'assist:describe'
): AssistDescription {
  const definition = requireAssist(request.assistId, channel)
  const seconds = expectedSeconds(
    { assistId: definition.id },
    historyDatabases(host, request.projectId),
    definition.expectedSeconds
  )
  return {
    assistId: definition.id,
    title: definition.title,
    label: assistLabel(connectionOf(host, request.projectId), seconds),
    savedDataOnly: definition.webSearch !== true,
    searchCost: 0,
    acceptsInstruction: definition.acceptsInstruction
  }
}

/**
 * `assist:run` (FR-25.1 to FR-25.6). Gathers saved data, renders the assist's task
 * with the shared output rules, calls the project's Claude connection through
 * `resolveClaude` (so the call is logged in `llm_calls`), and validates the reply.
 * Writes nothing to the project.
 */
export async function runAssist(
  host: EngineHost,
  request: AssistRunRequest
): Promise<AssistResult> {
  const channel = 'assist:run'
  const definition = requireAssist(request.assistId, channel)
  if (definition.needsProject && request.projectId === null) {
    throw new IpcRequestError(channel, 'Open a project first.')
  }
  for (const field of definition.needs ?? []) {
    if (request[field] === null) throw new IpcRequestError(channel)
  }
  const description = describeAssist(host, request, channel)
  const run = async (context: AssistContext): Promise<AssistResult> => {
    const gathering = progressStep({ kind: 'read', label: 'Reading your saved data' })
    let facts: string
    try {
      facts = await gatherFacts(definition, context, host)
    } catch (error) {
      gathering.fail(error instanceof PipelineError ? error.message : 'Could not read saved data')
      throw error
    }
    const web = definition.webSearch === true
    gathering.done(web ? 'Web search on for this answer' : 'No new searches')
    const saved = savedAnswer(definition, context)
    const build = web ? webAssistPrompt : assistPrompt
    const prompt = build({
      assistId: definition.id,
      task: definition.task,
      instruction: request.instruction,
      facts,
      rules: context.db === null ? [] : activeProjectRules(context.db)
    })
    // An assist registered by another area without panel words shows its title instead.
    progressHint(hasAssistPurpose(definition.id) ? null : definition.title)
    const asked =
      saved === null
        ? finished(definition, context, await askClaude(host, definition, context, prompt))
        : { reply: saved, durationMs: 0, model: null }
    const answered = {
      ...asked,
      reply: {
        ...asked.reply,
        items: [...asked.reply.items, ...(definition.savedItems?.(context) ?? [])]
      }
    }
    const count = answered.reply.items.length
    progressNote({
      kind: 'result',
      label:
        saved !== null
          ? 'Answer ready from saved data, no AI call'
          : count === 0
            ? 'Answer ready'
            : `${count} ${count === 1 ? 'suggestion' : 'suggestions'} ready`
    })
    const runId = `assist-${randomUUID()}`
    return {
      runId,
      assistId: definition.id,
      title: definition.title,
      summary: answered.reply.summary,
      items: answered.reply.items.map((item, index) => ({ ...item, id: `${runId}-${index + 1}` })),
      caution: answered.reply.caution,
      label: description.label,
      savedDataOnly: !web,
      searchesUsed: 0,
      durationMs: answered.durationMs,
      model: answered.model
    }
  }
  if (request.projectId === null) {
    return run({ host, request, project: null, db: null })
  }
  return withProject(host, request.projectId, channel, (opened) =>
    run({ host, request, project: opened.project, db: opened.db })
  )
}

/**
 * `answerFromSaved` when the user gave no instruction: an answer from a current saved
 * result, so the call to Claude is skipped. Null asks Claude.
 */
function savedAnswer(definition: AssistDefinition, context: AssistContext): AssistReply | null {
  const instruction = context.request.instruction?.trim() ?? ''
  if (definition.answerFromSaved === undefined || instruction.length > 0) return null
  return definition.answerFromSaved(context)
}

async function gatherFacts(
  definition: AssistDefinition,
  context: AssistContext,
  host: EngineHost
): Promise<string> {
  try {
    return redactString(await definition.gather(context), {
      secrets: host.knownSecrets(),
      hexKeys: true
    })
  } catch (error) {
    if (error instanceof AssistInputError) {
      throw new PipelineError(error.message, {
        code: 'not_found',
        nextStep: error.nextStep ?? 'Try again.'
      })
    }
    throw error
  }
}

/** Claude's checked answer after the assist's own code pass (lengths it measures). */
function finished<T extends { reply: AssistReply }>(
  definition: AssistDefinition,
  context: AssistContext,
  answer: T
): T {
  return definition.finish === undefined
    ? answer
    : { ...answer, reply: definition.finish(answer.reply, context) }
}

async function askClaude(
  host: EngineHost,
  definition: AssistDefinition,
  context: AssistContext,
  prompt: string
): Promise<{ reply: AssistReply; durationMs: number; model: string | null }> {
  // FR-11.7, LLM-5: the project's connection, fallback, and model.
  const provider = resolveClaude(host, 'assist:run', context.request.projectId)
  const model = projectClaudeModel(host, context.request.projectId)
  let current = prompt
  let durationMs = 0
  let problem = 'The reply did not match the schema.'
  // A web-search call sends no schema (as `completeAssist` does); the reply is parsed and
  // validated against the same schema here.
  const web = definition.webSearch === true
  for (let attempt = 0; attempt < ASSIST_ATTEMPTS; attempt += 1) {
    let json: unknown
    let resolved: string | null
    try {
      const completion = await provider.complete({
        prompt: current,
        schema: web ? null : ASSIST_REPLY_SCHEMA,
        model,
        maxTokens: 4000,
        schemaAttempts: 1,
        ...(web ? { webSearch: true } : {}),
        trace: {
          source: 'assist',
          projectId: context.request.projectId,
          templateKind: null,
          templateId: null,
          templateHash: null,
          assistId: definition.id
        }
      })
      durationMs += completion.durationMs
      resolved = completion.resolvedModel ?? completion.model
      json = completion.json ?? parseJson(completion.text)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
      throw new PipelineError(message, {
        code: 'fetch_failed',
        nextStep: error instanceof ProviderError ? (error.nextStep ?? 'Try again.') : 'Try again.',
        secrets: host.knownSecrets()
      })
    }
    const check = progressStep({ kind: 'check', label: 'Checking the answer' })
    const read = readAssistReply(json, definition)
    if ('reply' in read) {
      const extra = definition.check?.(read.reply, context) ?? null
      if (extra === null) {
        check.done()
        return { reply: read.reply, durationMs, model: resolved }
      }
      problem = extra
    } else {
      problem = read.problem
    }
    const last = attempt + 1 >= ASSIST_ATTEMPTS
    check.fail(last ? problem : `${problem} · asking again`)
    if (!last) progressRetryNext()
    current = `${prompt}\n\nThe previous reply was rejected: ${problem} Reply again with JSON that follows every rule.`
  }
  throw new PipelineError(problem, { code: 'schema_validation', nextStep: 'Try again.' })
}

function requireAssist(id: string, channel: string): AssistDefinition {
  const definition = getAssist(id)
  if (definition === null) throw new IpcRequestError(channel, 'That assist is not available.')
  return definition
}

/** The databases whose `llm_calls` hold this assist's history. */
export function historyDatabases(host: EngineHost, projectId: string | null): SqliteDatabase[] {
  const databases: SqliteDatabase[] = [host.storage.db]
  if (projectId !== null) {
    const project = getProject(host.storage.db, projectId)
    if (project !== null) {
      try {
        databases.push(projectDatabasePool(host.storage).get(project.slug))
      } catch {
        // An unreadable project file only loses its history.
      }
    }
  }
  return databases
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown
    } catch {
      return null
    }
  }
}
