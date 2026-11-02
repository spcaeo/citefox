import {
  EMPTY_ASK_FILTERS,
  type AskAnswer,
  type AskFilterRequest,
  type AskFilters,
  type AskOptions,
  type AskProjectRequest,
  type AskQuestionRequest,
  type AssistLabel
} from '@shared/ipc'
import { assistLabel, connectionOf, expectedSeconds } from '../assist/label'
import { historyDatabases } from '../assist/run'
import { projectClaudeModel, resolveClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { withProject, type OpenProject } from '../engine/project-db'
import { readAskFilters } from '../ipc-ai'
import { IpcRequestError } from '../ipc-request'
import { redactString } from '../logging/redact'
import { PipelineError } from '../pipeline/errors'
import { ProviderError } from '../providers/errors'
import { askCompetitors, askPages } from './context'
import { askPrompt } from './prompt'
import { citedDomainCounts, queryScope, readAskScope, type AskScope } from './query'
import { ASK_REPLY_SCHEMA } from './schema'
import { answerText, chipsFor, NO_CHECKS_ANSWER } from './words'

/** `llm_calls.assist_id` for Ask CiteFox, and the key for its expected duration. */
export const ASK_ASSIST_ID = 'ask.citefox'

/** Shipped estimate until `llm_calls` has history (the mock-up says "about 5 s"). */
const ASK_EXPECTED_SECONDS = 5

/** The reply and one retry with the problem named. */
const ASK_ATTEMPTS = 2

/** Most cited domains offered in the chip editor, and listed in the prompt. */
const OPTION_DOMAIN_LIMIT = 30

/**
 * `ask:question` (FR-25.7). Claude turns the question into filters, validated
 * against the schema and the project's ids; the local query answers. When no
 * check has finished, Claude is not called. Never makes a search.
 */
export async function askQuestion(
  host: EngineHost,
  request: AskQuestionRequest
): Promise<AskAnswer> {
  const channel = 'ask:question'
  const label = askLabel(host, request.projectId)
  return withProject(host, request.projectId, channel, async (opened) => {
    const scope = readAskScope(opened.db, opened.project, host.now())
    if (scope.rows.length === 0) {
      return {
        ...answerFor(scope, EMPTY_ASK_FILTERS, request.question, null),
        answer: NO_CHECKS_ANSWER
      }
    }
    const reply = await askClaude(host, opened, scope, request)
    return answerFor(scope, reply.filters, request.question, label, reply.notCovered)
  })
}

/** `ask:filter`. Edited chips: the same query, no Claude call. */
export function filterAnswer(host: EngineHost, request: AskFilterRequest): Promise<AskAnswer> {
  return withProject(host, request.projectId, 'ask:filter', (opened) => {
    const scope = readAskScope(opened.db, opened.project, host.now())
    return answerFor(scope, request.filters, null, null)
  })
}

/** `ask:options`. Choices for "Add filter". */
export function askOptions(host: EngineHost, request: AskProjectRequest): Promise<AskOptions> {
  return withProject(host, request.projectId, 'ask:options', (opened) => {
    const scope = readAskScope(opened.db, opened.project, host.now())
    return {
      pages: scope.pages.map((page) => ({
        id: page.id,
        label: page.label,
        kind: page.kind ?? 'page'
      })),
      markets: scope.markets,
      domains: citedDomainCounts(scope.rows, OPTION_DOMAIN_LIMIT)
    }
  })
}

function answerFor(
  scope: AskScope,
  filters: AskFilters,
  question: string | null,
  label: AssistLabel | null,
  notCovered: string | null = null
): AskAnswer {
  const result = queryScope(scope, filters)
  return {
    question,
    filters: result.filters,
    chips: chipsFor(result.filters, scope),
    answer: answerText(result),
    rows: result.rows,
    total: result.total,
    searched: result.searched,
    checkedThrough: result.checkedThrough,
    savedDataOnly: true,
    label,
    notCovered
  }
}

function askLabel(host: EngineHost, projectId: string): AssistLabel {
  const seconds = expectedSeconds(
    { assistId: ASK_ASSIST_ID },
    historyDatabases(host, projectId),
    ASK_EXPECTED_SECONDS
  )
  return assistLabel(connectionOf(host, projectId), seconds)
}

interface AskReply {
  filters: AskFilters
  notCovered: string | null
}

async function askClaude(
  host: EngineHost,
  opened: OpenProject,
  scope: AskScope,
  request: AskQuestionRequest
): Promise<AskReply> {
  // FR-11.7, LLM-5: the project's connection, fallback, and model.
  const provider = resolveClaude(host, 'ask:question', request.projectId)
  const model = projectClaudeModel(host, request.projectId)
  const prompt = redactString(
    askPrompt({
      question: request.question,
      domain: opened.project.domain,
      pages: askPages(opened.db, scope),
      markets: scope.markets,
      competitors: askCompetitors(opened.db),
      citedDomains: citedDomainCounts(scope.rows, OPTION_DOMAIN_LIMIT),
      today: host.now().toISOString().slice(0, 10)
    }),
    { secrets: host.knownSecrets(), hexKeys: true }
  )
  let current = prompt
  let problem = 'The reply did not match the schema.'
  for (let attempt = 0; attempt < ASK_ATTEMPTS; attempt += 1) {
    let json: unknown
    try {
      const completion = await provider.complete({
        prompt: current,
        schema: ASK_REPLY_SCHEMA,
        model,
        maxTokens: 1500,
        schemaAttempts: 1,
        trace: {
          source: 'ask',
          projectId: request.projectId,
          templateKind: null,
          templateId: null,
          templateHash: null,
          assistId: ASK_ASSIST_ID
        }
      })
      json = completion.json ?? parseJson(completion.text)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
      throw new PipelineError(message, {
        code: 'fetch_failed',
        nextStep: error instanceof ProviderError ? (error.nextStep ?? 'Try again.') : 'Try again.',
        secrets: host.knownSecrets()
      })
    }
    const read = readReply(json)
    if ('reply' in read) return read.reply
    problem = read.problem
    current = `${prompt}\n\nThe previous reply was rejected: ${problem} Answer again with JSON that follows the schema.`
  }
  throw new PipelineError(problem, { code: 'schema_validation', nextStep: 'Ask again.' })
}

/** Claude's reply as filters, or the sentence that rejects it. Unknown ids are dropped later. */
export function readReply(value: unknown): { reply: AskReply } | { problem: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problem: 'The reply was not a JSON object.' }
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some((key) => key !== 'filters' && key !== 'notCovered') || !('filters' in record)) {
    return { problem: 'The reply must hold only "filters" and "notCovered".' }
  }
  let filters: AskFilters
  try {
    filters = readAskFilters(record.filters, 'ask:question')
  } catch (error) {
    if (error instanceof IpcRequestError) {
      return { problem: 'The filters did not match the schema.' }
    }
    throw error
  }
  const notCovered = record.notCovered
  if (notCovered !== undefined && notCovered !== null && typeof notCovered !== 'string') {
    return { problem: '"notCovered" must be a string or null.' }
  }
  return { reply: { filters, notCovered: cleanNote(notCovered ?? null) } }
}

function cleanNote(value: string | null): string | null {
  if (value === null) return null
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (text.length === 0) return null
  return text.length > 600 ? `${text.slice(0, 599)}…` : text
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
