import {
  DEFAULT_PROMPT_COUNT,
  PLAYGROUND_COMPARE_LIMIT,
  PLAYGROUND_MEMORY_RUNS,
  type GenerationTemplateKind
} from '@shared/domain'
import {
  TEMPLATE_ERROR_MESSAGES,
  isPlaygroundSavePart,
  type PlaygroundAioPromptResult,
  type PlaygroundAioRequest,
  type PlaygroundAioResult,
  type PlaygroundRunRequest,
  type PlaygroundRunResult,
  type PlaygroundSavePart,
  type SavePlaygroundRunRequest,
  type SavePlaygroundRunResult,
  type TemplateErrorCode
} from '@shared/ipc'
import { MOCK_PACE_STORAGE_KEY } from '../../onboarding/flags'
import { getM2Memory, type StoredRun, type StoredTemplate } from './memory'
import { renderTemplate } from '../../templates/syntax'
import { sha256Hex } from './sha256'
import {
  PLAYGROUND_KEY_ID,
  PLAYGROUND_KEY_LABEL,
  aioForPrompt,
  coverageOutput,
  isTextboltUrl,
  pageFacts,
  profileOutput,
  promptOutput,
  templateValues
} from './textbolt'

const RESOLVED_MODEL = 'claude-sonnet-5-5'

export async function runPlayground(
  request: PlaygroundRunRequest
): Promise<readonly PlaygroundRunResult[]> {
  const channel = 'playground:run'
  await wait(readPace())
  const url = request.url.trim()
  if (url.length === 0) throw new Error(`${channel}: Invalid request`)
  const templates = selectTemplates(request)
  const overrides = request.overrides
  const promptCount = readPromptCount(overrides?.promptCount ?? null, channel)
  const brandName = readBrand(overrides?.brandName ?? null, channel)
  const facts = pageFacts(url, brandName)
  const memory = getM2Memory()
  const built: PlaygroundRunResult[] = []
  for (const [index, template] of templates.entries()) {
    const body = overrides?.body ?? template.body
    const rendered = renderTemplate(body, channel, templateValues(facts, promptCount))
    const templateHash = await sha256Hex(body)
    built.push({
      runId: `pg-${memory.nextRun + index}`,
      url,
      templateId: template.id,
      templateName: template.name,
      templateHash,
      templateUpdatedAt: template.updatedAt,
      renderedPrompt: rendered.text,
      modelOutput: modelOutput(template.kind, facts, promptCount, template.name),
      resolvedModel: RESOLVED_MODEL,
      usage: {
        inputTokens: 1800,
        outputTokens: template.kind === 'coverage' ? 1400 : 900,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        serpapiSearches: 0
      },
      durationMs: template.kind === 'coverage' ? 3800 : 1800,
      warnings: rendered.analysis.warnings
    })
  }
  for (const [index, result] of built.entries()) {
    const template = templates[index]
    if (!template) continue
    memory.runs.push({
      result,
      kind: template.kind,
      aio: null,
      produced: producedFor(template.kind)
    })
  }
  memory.nextRun += built.length
  if (memory.runs.length > PLAYGROUND_MEMORY_RUNS) {
    memory.runs.splice(0, memory.runs.length - PLAYGROUND_MEMORY_RUNS)
  }
  return built
}

function selectTemplates(request: PlaygroundRunRequest): StoredTemplate[] {
  const ids = request.templateIds
  const hasId = request.templateId !== undefined
  const hasIds = ids !== undefined && ids.length > 0
  if (hasId && hasIds) throw contractError('selection_conflict')
  if (hasIds && ids) {
    if (ids.length > PLAYGROUND_COMPARE_LIMIT) throw contractError('compare_limit')
    const chosen = ids.map((id) => requireRunnable(id))
    const kind = chosen[0]?.kind
    if (chosen.some((item) => item.kind !== kind)) throw contractError('kind_mismatch')
    if (request.kind !== undefined && request.kind !== kind) throw contractError('kind_mismatch')
    return chosen
  }
  if (hasId) {
    const id = request.templateId
    if (id === undefined) throw contractError('selection_required')
    const chosen = requireRunnable(id)
    if (request.kind !== undefined && request.kind !== chosen.kind) {
      throw contractError('kind_mismatch')
    }
    return [chosen]
  }
  if (request.kind !== undefined) {
    const kind = request.kind
    const chosen = getM2Memory().templates.find(
      (item) => item.kind === kind && item.isDefault && item.deletedAt === null
    )
    if (!chosen) throw contractError('not_found')
    return [chosen]
  }
  throw contractError('selection_required')
}

function requireRunnable(id: string): StoredTemplate {
  const found = getM2Memory().templates.find((item) => item.id === id)
  if (!found) throw contractError('not_found')
  if (found.deletedAt !== null) throw contractError('deleted')
  return found
}

function contractError(code: TemplateErrorCode): Error {
  return new Error(`playground:run: ${TEMPLATE_ERROR_MESSAGES[code]}`)
}

export async function checkPlaygroundAio(
  request: PlaygroundAioRequest
): Promise<PlaygroundAioResult> {
  const channel = 'playground:checkAio'
  await wait(readPace())
  const url = request.url.trim()
  if (url.length === 0 || request.prompts.length === 0) {
    throw new Error(`${channel}: Invalid request`)
  }
  const prompts: PlaygroundAioPromptResult[] = request.prompts.map((prompt) => {
    const text = prompt.trim()
    if (text.length === 0) {
      return {
        prompt,
        ok: false,
        keyId: null,
        keyLabel: null,
        reason: 'other',
        message: 'Enter a prompt to check. No search was sent.',
        cited: null,
        citedSources: [],
        position: null,
        summary: null
      }
    }
    const fixture = aioForPrompt(text, url)
    return {
      prompt: text,
      ok: true,
      keyId: PLAYGROUND_KEY_ID,
      keyLabel: PLAYGROUND_KEY_LABEL,
      reason: null,
      message: null,
      cited: fixture.cited,
      citedSources: fixture.sources,
      position: fixture.position,
      summary: fixture.summary
    }
  })
  const result: PlaygroundAioResult = { url, runId: request.runId, prompts }
  if (request.runId) {
    const stored = getM2Memory().runs.find((run) => run.result.runId === request.runId)
    if (stored) {
      stored.aio = result
      const searches = prompts.reduce((count, item) => count + (item.ok ? 1 : 0), 0)
      stored.result = {
        ...stored.result,
        usage: {
          ...stored.result.usage,
          serpapiSearches: stored.result.usage.serpapiSearches + searches
        }
      }
      if (!stored.produced.includes('aioChecks')) stored.produced.push('aioChecks')
    }
  }
  return result
}

export function savePlaygroundRun(request: SavePlaygroundRunRequest): SavePlaygroundRunResult {
  const channel = 'playground:saveToProject'
  if (request.projectId.trim().length === 0 || request.parts.length === 0) {
    throw new Error(`${channel}: Invalid request`)
  }
  if (request.parts.some((part) => !isPlaygroundSavePart(part))) {
    throw new Error(`${channel}: Invalid request`)
  }
  const stored = getM2Memory().runs.find((run) => run.result.runId === request.runId)
  if (!stored) throw new Error(`${channel}: Invalid request`)
  const written = request.parts.filter((part) => stored.produced.includes(part))
  return {
    projectId: request.projectId,
    pageId: pageIdFor(stored.result.url),
    runId: request.runId,
    parts: written
  }
}

export function listPlaygroundRuns(): readonly PlaygroundRunResult[] {
  return getM2Memory().runs.map((run) => run.result)
}

function modelOutput(
  kind: GenerationTemplateKind,
  facts: ReturnType<typeof pageFacts>,
  count: number,
  templateName: string
): string {
  if (kind === 'buyer_profile') return profileOutput(facts, templateName)
  if (kind === 'buyer_prompts') return promptOutput(count, templateName)
  return coverageOutput(facts, templateName)
}

function producedFor(kind: GenerationTemplateKind): PlaygroundSavePart[] {
  const parts: PlaygroundSavePart[] = ['pageRead']
  if (kind === 'buyer_profile') parts.push('buyerProfile')
  if (kind === 'buyer_prompts') parts.push('prompts')
  if (kind === 'coverage') parts.push('coverage')
  return parts
}

function pageIdFor(url: string): string {
  if (isTextboltUrl(url)) return 'alerts'
  return 'playground-page'
}

function readPromptCount(value: number | null, channel: string): number {
  if (value === null) return DEFAULT_PROMPT_COUNT
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error(`${channel}: Invalid request`)
  }
  return value
}

function readBrand(value: string | null, channel: string): string | null {
  if (value === null) return null
  if (value.length === 0 || value.trim() !== value) throw new Error(`${channel}: Invalid request`)
  return value
}

function readPace(): number {
  if (typeof localStorage === 'undefined') return 0
  const stored = localStorage.getItem(MOCK_PACE_STORAGE_KEY)
  if (stored === null || stored.length === 0) return 0
  const value = Number(stored)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function wait(ms: number): Promise<void> {
  if (ms === 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function storedRun(runId: string): StoredRun | null {
  return getM2Memory().runs.find((run) => run.result.runId === runId) ?? null
}
