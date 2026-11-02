import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import {
  TOPIC_EXPECTED_SECONDS,
  type GenerationTemplate,
  type TopicTemplateKind
} from '@shared/domain'
import type { TopicCallInfo } from '@shared/ipc'
import { assistLabel, connectionOf, expectedSeconds } from '../assist/label'
import { historyDatabases } from '../assist/run'
import { projectClaudeModel, resolveClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { redactString } from '../logging/redact'
import { PipelineError, type ValidationProblem } from '../pipeline/errors'
import { completeStructured } from '../pipeline/llm'
import { withProjectRules } from '../prompts/project-rules'
import { modelFor } from '../pipeline/template-settings'
import {
  loadGenerationTemplate,
  renderTemplate,
  shippedBody,
  templateHash
} from '../pipeline/templates'
import type { SqliteDatabase } from '../storage/database'
import { activeProjectRules } from '../storage/project-rules'
import { getCurrentOverride } from '../storage/template-overrides'
import { TOPIC_SCHEMAS } from './templates'

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map<TopicTemplateKind, ReturnType<typeof ajv.compile>>()

function validatorFor(kind: TopicTemplateKind): ReturnType<typeof ajv.compile> {
  let validate = validators.get(kind)
  if (validate === undefined) {
    validate = ajv.compile(TOPIC_SCHEMAS[kind])
    validators.set(kind, validate)
  }
  return validate
}

/** The "Claude · about N s" label for a topic step, from `llm_calls` history. */
export function topicStepLabel(
  host: EngineHost,
  projectId: string | null,
  kind: TopicTemplateKind
): TopicCallInfo['label'] {
  const seconds = expectedSeconds(
    { templateKind: kind },
    historyDatabases(host, projectId),
    TOPIC_EXPECTED_SECONDS[kind]
  )
  return assistLabel(connectionOf(host, projectId), seconds)
}

export interface TopicCallResult<T> {
  value: T
  info: TopicCallInfo
  templateId: string
  templateName: string
  templateHash: string
}

/**
 * The notice when a project's own version of a step fails the step's current reply
 * shape (an older body written before the step was narrowed, Docs/PROMPT-AUDIT.md
 * section 3 rule 6) and the shipped body ran instead.
 */
export const OLD_FORMAT_NOTICE =
  'Your saved version of this step uses the old format; CiteFox used the built-in one. Update or reset it in Templates.'

/**
 * Runs one topic template: the project's version of the step (else the app
 * default), rendered with `context`, through the project's Claude connection
 * (logged in `llm_calls` by the provider wrapper), with the reply checked
 * against the step's schema and then `check` (one retry with the problem named).
 * When the project's own version fails that check or does not render, the shipped
 * body runs once instead and `info.notice` says so ({@link OLD_FORMAT_NOTICE}), so an
 * old saved body never stops the step. Never spends a SerpApi search.
 */
export async function runTopicTemplate<T>(options: {
  host: EngineHost
  db: SqliteDatabase
  projectId: string
  /** The topic page when there is one; generations are not stored for topic steps. */
  pageId: string | null
  kind: TopicTemplateKind
  channel: string
  context: Readonly<Record<string, string | number>>
  check?: (value: T) => string | null
}): Promise<TopicCallResult<T>> {
  const { host, kind } = options
  const template = loadGenerationTemplate(
    host.storage.db,
    kind,
    undefined,
    'templates:get',
    options.db
  )
  const started = Date.now()
  if (getCurrentOverride(options.db, kind) === null) {
    return callTopicTemplate(options, template, started)
  }
  try {
    return await callTopicTemplate(options, template, started)
  } catch (error) {
    if (!(error instanceof PipelineError) || !OLD_BODY_CODES.has(error.code)) throw error
    host.logger.warn('topic template: project version failed, using the shipped body', {
      kind,
      template: template.id,
      outcome: error.code
    })
    const result = await callTopicTemplate(options, shippedTemplate(host, kind), started)
    return { ...result, info: { ...result.info, notice: OLD_FORMAT_NOTICE } }
  }
}

/** Failures an older project body causes: a reply in the old shape, or a body that will not parse. */
const OLD_BODY_CODES: ReadonlySet<string> = new Set(['schema_validation', 'template'])

/** The app's own body for the step (the shipped one, even when the app default was edited). */
function shippedTemplate(host: EngineHost, kind: TopicTemplateKind): GenerationTemplate {
  const fallback = loadGenerationTemplate(host.storage.db, kind, undefined, 'templates:get')
  const body = shippedBody(kind) ?? fallback.body
  return { ...fallback, body, templateHash: templateHash(body) }
}

async function callTopicTemplate<T>(
  options: Parameters<typeof runTopicTemplate<T>>[0],
  template: GenerationTemplate,
  started: number
): Promise<TopicCallResult<T>> {
  const { host, kind } = options
  const secrets = host.knownSecrets()
  const prompt = topicPrompt(
    template.body,
    options.context,
    activeProjectRules(options.db),
    secrets
  )
  const validate = validatorFor(kind)
  const result = await completeStructured({
    db: options.db,
    pageId: options.pageId ?? '',
    provider: resolveClaude(host, options.channel, options.projectId),
    logger: host.logger,
    kind,
    templateId: template.id,
    templateHash: template.templateHash,
    prompt,
    schema: TOPIC_SCHEMAS[kind],
    model: modelFor(template.settings, projectClaudeModel(host, options.projectId)),
    inputHash: createHash('sha256').update(`${template.templateHash}\n${prompt}`).digest('hex'),
    validate: (value): ValidationProblem | null => {
      if (!validate(value)) {
        return { code: 'schema_validation', message: 'The reply did not match the schema.' }
      }
      const problem = options.check?.(value as T) ?? null
      return problem === null ? null : { code: 'schema_validation', message: problem }
    },
    secrets,
    trace: { source: 'pipeline', projectId: options.projectId }
  })
  return {
    value: result.value as T,
    info: {
      label: topicStepLabel(host, options.projectId, kind),
      durationMs: Math.max(0, Date.now() - started),
      model: null,
      searchesUsed: 0
    },
    templateId: template.id,
    templateName: template.name,
    templateHash: template.templateHash
  }
}

/**
 * A topic step's prompt: the template rendered with `context`, the owner's project
 * rules after its first line, then scrubbed of keys.
 */
export function topicPrompt(
  body: string,
  context: Readonly<Record<string, string | number>>,
  rules: readonly string[],
  secrets: readonly string[]
): string {
  return redactString(withProjectRules(renderTemplate(body, context).text, rules), {
    secrets,
    hexKeys: true
  })
}

/** Plain bullet lines for template variables; "None" when empty. */
export function bullets(lines: readonly string[]): string {
  const kept = lines.map((line) => line.trim()).filter(Boolean)
  return kept.length === 0 ? 'None' : kept.map((line) => `- ${line}`).join('\n')
}
