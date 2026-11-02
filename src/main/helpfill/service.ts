import type {
  HelpFillDescribeRequest,
  HelpFillEstimate,
  HelpFillEstimateRequest,
  HelpFillPrompt,
  HelpFillPromptRequest,
  HelpFillReadRequest,
  HelpFillResult,
  HelpFillScope
} from '@shared/ipc'
import { connectionOf } from '../assist/label'
import { claudePausedReason, planProjectClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { getProject } from '../storage/records'
import { HelpFillTargetMissing, readHelpFillContext } from './context'
import { settleRows } from './merge'
import { buildHelpFillPrompt, buildHelpFillTextPrompt } from './prompt'
import { readReply } from './reader'
import { getHelpFillKind } from './registry'
import { readTextReply, settleText } from './text'
import { HelpFillEvidenceMissing, type HelpFillContext, type HelpFillKindDef } from './types'

/**
 * `helpfill:*` (Docs/HELPFILL.md). Estimate reads the project's Claude connection
 * and never calls Claude. Prompt and Read open the project file once, read the
 * context and close it. Describe reads the context, closes the file, then runs the
 * kind's Claude path (for questions, the `prompts.more` assist). A text kind also
 * reads its evidence (the question, what Google cited, the report's numbers) for the
 * prompt and for its own check of the answer. Nothing is written.
 */

export function estimateHelpFill(
  host: EngineHost,
  request: HelpFillEstimateRequest
): HelpFillEstimate {
  const channel = 'helpfill:estimate'
  const definition = requireKind(request.kind, channel)
  if (getProject(host.storage.db, request.projectId) === null) {
    throw new IpcRequestError(channel, 'That project was not found')
  }
  const calls = definition.describeCost.calls
  const callText = `${calls} AI ${calls === 1 ? 'call' : 'calls'}`
  if (definition.describe === undefined) {
    return {
      kind: definition.kind,
      available: false,
      calls: 0,
      costText: '',
      reason: 'Not offered here.'
    }
  }
  const connected =
    host.claude !== undefined ||
    planProjectClaude(host.storage, host.settings(), request.projectId).connection !== null
  if (!connected) {
    return {
      kind: definition.kind,
      available: false,
      calls,
      costText: callText,
      reason: 'Needs CiteFox AI connected.'
    }
  }
  const paused = claudePausedReason(host, request.projectId)
  if (paused !== null) {
    return { kind: definition.kind, available: false, calls, costText: callText, reason: paused }
  }
  const onPlan = connectionOf(host, request.projectId) === 'claude-code'
  return {
    kind: definition.kind,
    available: true,
    calls,
    costText: onPlan
      ? `${callText} · on your AI plan`
      : `${callText} · about ${dollars(definition.describeCost.usd)}`,
    reason: null
  }
}

export async function promptHelpFill(
  host: EngineHost,
  request: HelpFillPromptRequest
): Promise<HelpFillPrompt> {
  const channel = 'helpfill:prompt'
  const definition = requireKind(request.kind, channel)
  const context = await readContext(
    host,
    definition,
    request.projectId,
    request.scope,
    channel,
    request.items
  )
  if (definition.text !== undefined) {
    const evidence = await readEvidence(host, definition, context, channel)
    const built = buildHelpFillTextPrompt(definition, context, evidence, host.knownSecrets())
    return { kind: definition.kind, ...built }
  }
  const built = buildHelpFillPrompt(
    definition,
    context,
    request.count ?? definition.chatbotCount,
    host.knownSecrets()
  )
  return { kind: definition.kind, ...built }
}

export async function readHelpFill(
  host: EngineHost,
  request: HelpFillReadRequest
): Promise<HelpFillResult> {
  const channel = 'helpfill:read'
  const definition = requireKind(request.kind, channel)
  const context = await readContext(
    host,
    definition,
    request.projectId,
    request.scope,
    channel,
    request.items
  )
  if (definition.text !== undefined) {
    const read = readTextReply(request.text, definition.text.maxChars)
    const evidence = await checkEvidence(host, definition, context, channel, read.text)
    return settleText(definition, context, read, evidence)
  }
  const read = readReply(request.text, definition.sections)
  return settleRows(definition, context, read.rows, read.warnings)
}

export async function describeHelpFill(
  host: EngineHost,
  request: HelpFillDescribeRequest
): Promise<HelpFillResult> {
  const channel = 'helpfill:describe'
  const definition = requireKind(request.kind, channel)
  if (definition.describe === undefined) {
    throw new IpcRequestError(channel, 'Describe is not offered here.')
  }
  const context = await readContext(
    host,
    definition,
    request.projectId,
    request.scope,
    channel,
    request.items
  )
  const drafted = await definition.describe(host, context, {
    sentence: request.sentence,
    count: request.count
  })
  if (definition.text !== undefined) {
    const joined = drafted
      .map((row) => (row.values.text ?? '').trim())
      .filter((text) => text.length > 0)
      .join('\n\n')
    const read = readTextReply(joined, definition.text.maxChars)
    const evidence = await checkEvidence(host, definition, context, channel, read.text)
    return settleText(
      definition,
      context,
      joined.length === 0 ? { text: '', warnings: [NOTHING_NEW] } : read,
      evidence
    )
  }
  return settleRows(definition, context, drafted, drafted.length === 0 ? [NOTHING_NEW] : [])
}

const NOTHING_NEW = 'CiteFox AI had nothing new to suggest. Try other words.'

/** A text kind's evidence, with a missing piece as a plain error that names the next step. */
async function readEvidence(
  host: EngineHost,
  definition: HelpFillKindDef,
  context: HelpFillContext,
  channel: string
): Promise<readonly string[]> {
  try {
    return (await definition.text?.evidence(host, context)) ?? []
  } catch (error) {
    if (error instanceof HelpFillEvidenceMissing) {
      throw new IpcRequestError(channel, error.message, error.nextStep)
    }
    throw error
  }
}

/** The evidence a text kind's check compares the answer with; none is read without a check. */
async function checkEvidence(
  host: EngineHost,
  definition: HelpFillKindDef,
  context: HelpFillContext,
  channel: string,
  text: string
): Promise<readonly string[]> {
  if (definition.text?.check === undefined || text.length === 0) return []
  return readEvidence(host, definition, context, channel)
}

function requireKind(kind: string, channel: string): HelpFillKindDef {
  const definition = getHelpFillKind(kind)
  if (definition === null) throw new IpcRequestError(channel, 'That helper is not available.')
  return definition
}

async function readContext(
  host: EngineHost,
  definition: HelpFillKindDef,
  projectId: string,
  scope: HelpFillScope,
  channel: string,
  items?: readonly string[]
): Promise<HelpFillContext> {
  return withProject(host, projectId, channel, ({ project, db }) => {
    try {
      const context = {
        ...readHelpFillContext(db, project, scope.pageId),
        promptId: scope.promptId ?? null,
        subject: scope.subject ?? null
      }
      const extra = definition.extra?.(db, project, scope.pageId)
      const withItems = items === undefined ? context : { ...context, items }
      return extra === undefined ? withItems : { ...withItems, extra }
    } catch (error) {
      if (error instanceof HelpFillTargetMissing) {
        throw new IpcRequestError(channel, error.message, 'Pick a page or topic, then try again.')
      }
      throw error
    }
  })
}

/** "$0.01", "$0.25". */
function dollars(usd: number): string {
  return `$${usd.toFixed(2)}`
}
