import { BRAND_FACT_MAX_LENGTH, BRAND_PROMPT_MAX_LENGTH, isBrandPromptKind } from '@shared/domain'
import type {
  AddBrandFactRequest,
  BrandFactsRequest,
  BrandPromptDraft,
  DeleteBrandFactRequest,
  GenerateBrandPromptsRequest,
  RereadSentimentRequest,
  SaveBrandPromptsRequest,
  SentimentRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'

/** Request parsing for the `sentiment:*` channels. A bad shape names the channel only. */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MAX_DRAFTS = 40

export function parseSentimentRequest(value: unknown): SentimentRequest {
  const channel = 'sentiment:get'
  const record = object(value, channel, ['projectId', 'pageId', 'marketId'])
  return {
    projectId: id(record.projectId, channel),
    pageId: id(record.pageId, channel),
    marketId: record.marketId === null ? null : id(record.marketId, channel)
  }
}

export function parsePageRequest(
  value: unknown,
  channel: 'sentiment:generateBrandPrompts' | 'sentiment:reread'
): GenerateBrandPromptsRequest & RereadSentimentRequest {
  const record = object(value, channel, ['projectId', 'pageId'])
  return { projectId: id(record.projectId, channel), pageId: id(record.pageId, channel) }
}

export function parseSaveBrandPrompts(value: unknown): SaveBrandPromptsRequest {
  const channel = 'sentiment:saveBrandPrompts'
  const record = object(value, channel, ['projectId', 'pageId', 'prompts'])
  if (!Array.isArray(record.prompts) || record.prompts.length > MAX_DRAFTS) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: id(record.projectId, channel),
    pageId: id(record.pageId, channel),
    prompts: (record.prompts as unknown[]).map((entry) => draft(entry, channel))
  }
}

export function parseFactsRequest(value: unknown): BrandFactsRequest {
  const channel = 'sentiment:listFacts'
  const record = object(value, channel, ['projectId'])
  return { projectId: id(record.projectId, channel) }
}

export function parseAddFact(value: unknown): AddBrandFactRequest {
  const channel = 'sentiment:addFact'
  const record = object(value, channel, ['projectId', 'text', 'source'])
  const text = typeof record.text === 'string' ? record.text.replace(/\s+/g, ' ').trim() : ''
  if (text.length === 0 || text.length > BRAND_FACT_MAX_LENGTH) {
    throw new IpcRequestError(
      channel,
      `A brand fact is 1 to ${BRAND_FACT_MAX_LENGTH} characters.`,
      'Keep each fact short and true.'
    )
  }
  let source: string | null = null
  if (record.source !== null) {
    if (typeof record.source !== 'string' || record.source.length > 2000) {
      throw new IpcRequestError(channel)
    }
    source = record.source.trim().length === 0 ? null : record.source.trim()
  }
  return { projectId: id(record.projectId, channel), text: plain(text, channel), source }
}

export function parseDeleteFact(value: unknown): DeleteBrandFactRequest {
  const channel = 'sentiment:deleteFact'
  const record = object(value, channel, ['projectId', 'factId'])
  return { projectId: id(record.projectId, channel), factId: id(record.factId, channel) }
}

function draft(value: unknown, channel: string): BrandPromptDraft {
  const record = object(value, channel, ['kind', 'language', 'text'])
  if (typeof record.kind !== 'string' || !isBrandPromptKind(record.kind)) {
    throw new IpcRequestError(channel)
  }
  const language = typeof record.language === 'string' ? record.language.trim().toLowerCase() : ''
  if (!/^[a-z0-9-]{1,20}$/.test(language)) throw new IpcRequestError(channel)
  const text = typeof record.text === 'string' ? record.text.replace(/\s+/g, ' ').trim() : ''
  if (text.length < 3 || text.length > BRAND_PROMPT_MAX_LENGTH) {
    throw new IpcRequestError(
      channel,
      `A brand prompt is 3 to ${BRAND_PROMPT_MAX_LENGTH} characters.`,
      'Shorten the prompt and save again.'
    )
  }
  return { kind: record.kind, language, text: plain(text, channel) }
}

function object(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const present = Object.keys(record)
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new IpcRequestError(channel)
  }
  return record
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function plain(value: string, channel: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) throw new IpcRequestError(channel)
  }
  return value
}
