import { ASSISTANT_EXPECTED_SECONDS, type AssistantTemplateKind } from '@shared/domain'
import type { AssistLabel } from '@shared/ipc'
import { assistLabel, connectionOf, expectedSeconds } from '../assist/label'
import { historyDatabases } from '../assist/run'
import { projectClaudeModel, resolveClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { PipelineError } from '../pipeline/errors'
import { ProviderError } from '../providers/errors'
import { unknownNumbers } from './numbers'
import { readAssistantReply, type RawReply } from './reply'
import { ASSISTANT_REPLY_SCHEMA } from './templates'

/**
 * The one Claude call behind every Ask CiteFox answer, for a project or (no
 * project open) for the app: the label it shows, the reply in the checked
 * shape, and one retry naming an invented number.
 */

/** The reply and one retry with the problem named. */
const ATTEMPTS = 2

export function labelFor(
  host: EngineHost,
  projectId: string | null,
  kind: AssistantTemplateKind
): AssistLabel {
  const seconds = expectedSeconds(
    { templateKind: kind },
    historyDatabases(host, projectId),
    ASSISTANT_EXPECTED_SECONDS[kind]
  )
  return assistLabel(connectionOf(host, projectId), seconds)
}

export async function askClaude(
  host: EngineHost,
  projectId: string | null,
  kind: AssistantTemplateKind,
  prompt: string,
  allowed: ReadonlySet<string>,
  templateId: string,
  templateHash: string
): Promise<RawReply> {
  const provider = resolveClaude(host, 'assistant:ask', projectId)
  const model = projectClaudeModel(host, projectId)
  let current = prompt
  let problem = 'The reply did not match the schema.'
  let last: RawReply | null = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let json: unknown
    try {
      const completion = await provider.complete({
        prompt: current,
        schema: ASSISTANT_REPLY_SCHEMA as unknown as Record<string, unknown>,
        model,
        maxTokens: 2000,
        schemaAttempts: 1,
        trace: {
          source: 'assist',
          projectId,
          templateKind: kind,
          templateId,
          templateHash,
          assistId: null
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
    const read = readAssistantReply(json)
    if ('reply' in read) {
      last = read.reply
      const invented = unknownNumbers(read.reply.text, allowed)
      if (invented.length === 0) return read.reply
      problem = `These numbers are not in the data: ${invented.join(', ')}. Use only the numbers listed, or say the number is not in the saved data.`
    } else {
      problem = read.problem
    }
    current = `${prompt}\n\nThe previous reply was rejected: ${problem} Reply again with JSON that follows every rule.`
  }
  // A reply in the right shape whose numbers are still wrong: the caller strips them.
  if (last !== null) return last
  throw new PipelineError(problem, { code: 'schema_validation', nextStep: 'Ask again.' })
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
