import {
  isCountryCode,
  isIntentStage,
  isIntervalDays,
  isLanguageTag,
  isMarketDevice,
  isPageReadReader,
  isProjectStatus,
  isPromptSource,
  isSampleCount
} from '@shared/domain'
import type {
  IntentStage,
  IntervalDays,
  MarketDevice,
  PageReadReader,
  ProjectStatus,
  PromptSource,
  SampleCount
} from '@shared/domain'
import type {
  AddPageRequest,
  AddPromptRequest,
  AddQuestionsRequest,
  NewQuestion,
  CoverageRunRequest,
  CreateProjectRequest,
  EditPromptRequest,
  CheckCompanyDomainRequest,
  FillFromWebsiteRequest,
  GenerateBuyerProfileRequest,
  GenerateCoverageRequest,
  GeneratePromptsRequest,
  MarketDraft,
  PageIdRequest,
  ProductCompetitorsRequest,
  ProjectIdRequest,
  ReorderPromptsRequest,
  RewordPromptRequest,
  SearchPagesRequest,
  SetActivePromptSetRequest,
  SetGapDoneRequest,
  SetPromptEnabledRequest,
  StartPageReadRequest,
  UpdateBuyerProfileRequest,
  UpdatePageRequest,
  UpdateProjectRequest
} from '@shared/ipc'

import { IpcRequestError, readBuyerContextLists } from './ipc-request'
import { parseCreateOptions } from './ipc-project-settings'
import { MAX_PROMPT_COUNT } from './storage/pages'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63})$/

export function parseProjectId(value: unknown, channel: string): ProjectIdRequest {
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

export function parseCreateProject(value: unknown): CreateProjectRequest {
  const channel = 'projects:create'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    [
      'name',
      'domain',
      'includeSubdomains',
      'brandNames',
      'competitors',
      'clientName',
      'country',
      'language',
      'location',
      'device',
      'copySettingsFrom',
      'search',
      'claude',
      'switchingFrom',
      'integrations'
    ],
    ['copySettingsFrom', 'search', 'claude', 'switchingFrom', 'integrations']
  )
  return {
    ...parseCreateOptions(record, channel),
    name: readLabel(record.name, channel, 200),
    domain: readDomain(record.domain, channel),
    includeSubdomains: readBoolean(record.includeSubdomains, channel),
    brandNames: readNameList(record.brandNames, channel, true),
    competitors: readNameList(record.competitors, channel, false),
    clientName: readNullableLabel(record.clientName, channel, 200),
    country: readCountry(record.country, channel),
    language: readLanguage(record.language, channel),
    location: readNullableLabel(record.location, channel, 120),
    device: readDevice(record.device, channel),
    ...readBuyerContextLists(record, channel)
  }
}

export function parseUpdateProject(value: unknown): UpdateProjectRequest {
  const channel = 'projects:update'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    [
      'projectId',
      'name',
      'domain',
      'includeSubdomains',
      'brandNames',
      'competitors',
      'clientName',
      'status',
      'country',
      'language',
      'location',
      'device'
    ],
    [
      'name',
      'domain',
      'includeSubdomains',
      'brandNames',
      'competitors',
      'clientName',
      'status',
      'country',
      'language',
      'location',
      'device'
    ]
  )
  const request: UpdateProjectRequest = { projectId: readId(record.projectId, channel) }
  if (has(record, 'name')) request.name = readLabel(record.name, channel, 200)
  if (has(record, 'domain')) request.domain = readDomain(record.domain, channel)
  if (has(record, 'includeSubdomains')) {
    request.includeSubdomains = readBoolean(record.includeSubdomains, channel)
  }
  if (has(record, 'brandNames')) request.brandNames = readNameList(record.brandNames, channel, true)
  if (has(record, 'competitors')) {
    request.competitors = readNameList(record.competitors, channel, false)
  }
  if (has(record, 'clientName')) {
    request.clientName = readNullableLabel(record.clientName, channel, 200)
  }
  if (has(record, 'status')) request.status = readProjectStatus(record.status, channel)
  if (has(record, 'country')) request.country = readCountry(record.country, channel)
  if (has(record, 'language')) request.language = readLanguage(record.language, channel)
  if (has(record, 'location')) request.location = readNullableLabel(record.location, channel, 120)
  if (has(record, 'device')) request.device = readDevice(record.device, channel)
  return request
}

export function parseFillFromWebsite(value: unknown): FillFromWebsiteRequest {
  const channel = 'projects:fillFromWebsite'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    ['projectId', 'domain', 'market', 'brandOnly'],
    ['market', 'brandOnly']
  )
  const request: FillFromWebsiteRequest = {
    projectId: readNullableId(record.projectId, channel),
    domain: readDomain(record.domain, channel)
  }
  // Batch 2 row 5: the market chosen on the form, for the competitor question.
  if (has(record, 'market') && record.market !== null) {
    const market = plain(record.market, channel)
    requireKeys(market, channel, ['country', 'language'])
    request.market = {
      country: readCountry(market.country, channel),
      language: readLanguage(market.language, channel)
    }
  } else if (has(record, 'market')) {
    request.market = null
  }
  if (has(record, 'brandOnly')) {
    if (typeof record.brandOnly !== 'boolean') {
      throw new IpcRequestError(channel, 'brandOnly must be true or false')
    }
    request.brandOnly = record.brandOnly
  }
  return request
}

/** `projects:searchProductCompetitors`: one product's competitor search again. */
export function parseProductCompetitors(value: unknown): ProductCompetitorsRequest {
  const channel = 'projects:searchProductCompetitors'
  const record = plain(value, channel)
  requireKeys(record, channel, [
    'projectId',
    'domain',
    'market',
    'summary',
    'product',
    'comparedWith',
    'brandNames',
    'notCompetitors'
  ])
  let market: ProductCompetitorsRequest['market'] = null
  if (record.market !== null) {
    const raw = plain(record.market, channel)
    requireKeys(raw, channel, ['country', 'language'])
    market = {
      country: readCountry(raw.country, channel),
      language: readLanguage(raw.language, channel)
    }
  }
  const product = plain(record.product, channel)
  requireKeys(product, channel, ['id', 'name', 'job', 'buyer'])
  return {
    projectId: readNullableId(record.projectId, channel),
    domain: readDomain(record.domain, channel),
    market,
    summary: record.summary === null ? null : readPlain(record.summary, channel, 4000),
    product: {
      id: readId(product.id, channel),
      name: readPlain(product.name, channel, 200),
      job: readPlain(product.job, channel, 2000),
      // A product read from a chatbot's answer may have no buyer line.
      buyer: product.buyer === '' ? '' : readPlain(product.buyer, channel, 600)
    },
    comparedWith: readShortTexts(record.comparedWith, channel, 20, 80),
    brandNames: readShortTexts(record.brandNames, channel, 30, 120),
    notCompetitors: readShortTexts(record.notCompetitors, channel, 60, 200)
  }
}

/** Up to `count` short plain texts (company names); may be empty. */
function readShortTexts(value: unknown, channel: string, count: number, max: number): string[] {
  if (!Array.isArray(value) || value.length > count) throw new IpcRequestError(channel)
  return value.map((entry) => readPlain(entry, channel, max))
}

export function parseCheckCompanyDomain(value: unknown): CheckCompanyDomainRequest {
  const channel = 'projects:checkCompanyDomain'
  const record = plain(value, channel)
  requireKeys(record, channel, ['domain'])
  // Any short text: the engine answers "Enter a domain such as example.com" when it is not one.
  return { domain: readPlain(record.domain, channel, 300) }
}

export function parseSetActivePromptSet(value: unknown): SetActivePromptSetRequest {
  const channel = 'prompts:setActive'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'promptSetId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptSetId: readId(record.promptSetId, channel)
  }
}

export function parsePageId(value: unknown, channel: string): PageIdRequest {
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId'])
  return { projectId: readId(record.projectId, channel), pageId: readId(record.pageId, channel) }
}

export function parseAddPage(value: unknown): AddPageRequest {
  const channel = 'pages:add'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    ['projectId', 'url', 'markets', 'intervalDays', 'samples', 'promptCount', 'checkWhenReady'],
    ['checkWhenReady']
  )
  if (has(record, 'checkWhenReady') && typeof record.checkWhenReady !== 'boolean') {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    url: readHttpUrl(record.url, channel),
    markets: readMarkets(record.markets, channel),
    intervalDays: readInterval(record.intervalDays, channel),
    samples: readSamples(record.samples, channel),
    promptCount: readPromptCount(record.promptCount, channel),
    ...(record.checkWhenReady === true ? { checkWhenReady: true } : {})
  }
}

export function parseUpdatePage(value: unknown): UpdatePageRequest {
  const channel = 'pages:update'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    [
      'projectId',
      'pageId',
      'url',
      'label',
      'intervalDays',
      'samples',
      'promptCount',
      'defaultMarketId',
      'markets',
      'status'
    ],
    [
      'url',
      'label',
      'intervalDays',
      'samples',
      'promptCount',
      'defaultMarketId',
      'markets',
      'status'
    ]
  )
  const request: UpdatePageRequest = {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel)
  }
  if (has(record, 'url')) request.url = readHttpUrl(record.url, channel)
  if (has(record, 'label')) request.label = readNullableLabel(record.label, channel, 80)
  if (has(record, 'intervalDays')) request.intervalDays = readInterval(record.intervalDays, channel)
  if (has(record, 'samples')) request.samples = readSamples(record.samples, channel)
  if (has(record, 'promptCount')) request.promptCount = readPromptCount(record.promptCount, channel)
  if (has(record, 'defaultMarketId')) {
    request.defaultMarketId = readId(record.defaultMarketId, channel)
  }
  if (has(record, 'markets')) {
    const markets = readMarkets(record.markets, channel)
    if (markets.length === 0) {
      throw new IpcRequestError(channel, 'A page needs at least one market')
    }
    request.markets = markets
  }
  if (has(record, 'status')) request.status = readPageWorkingStatus(record.status, channel)
  return request
}

export function parseSearchPages(value: unknown): SearchPagesRequest {
  const channel = 'pages:search'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'query'])
  return {
    projectId: readId(record.projectId, channel),
    query: readSearchQuery(record.query, channel)
  }
}

export function parseStartPageRead(value: unknown): StartPageReadRequest {
  const channel = 'pages:readStart'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'reader', 'suppliedText'])
  const reader = readReader(record.reader, channel)
  const suppliedText = readSuppliedText(record.suppliedText, channel)
  if (reader === 'file' && suppliedText === null) {
    throw new IpcRequestError(channel, 'Choose a file that contains the page text')
  }
  if (reader !== 'file' && suppliedText !== null) {
    throw new IpcRequestError(channel, 'Invalid request')
  }
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    reader,
    suppliedText
  }
}

export function parseGenerateProfile(value: unknown): GenerateBuyerProfileRequest {
  const channel = 'buyerProfile:generate'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    ['projectId', 'pageId', 'templateId', 'fresh'],
    ['templateId', 'fresh']
  )
  const request: GenerateBuyerProfileRequest = {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel)
  }
  if (has(record, 'templateId')) request.templateId = readId(record.templateId, channel)
  if (has(record, 'fresh')) request.fresh = readBoolean(record.fresh, channel)
  return request
}

export function parseGeneratePrompts(value: unknown): GeneratePromptsRequest {
  return parseOptionalTemplate(value, 'prompts:generate')
}

export function parseGenerateCoverage(value: unknown): GenerateCoverageRequest {
  return parseOptionalTemplate(value, 'gaps:generate')
}

export function parseSetGapDone(value: unknown): SetGapDoneRequest {
  const channel = 'gaps:setDone'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'promptId', 'done'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel),
    done: readBoolean(record.done, channel)
  }
}

export function parseCoverageRun(value: unknown): CoverageRunRequest {
  const channel = 'coverage:get'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'runId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    runId: readId(record.runId, channel)
  }
}

export function parseUpdateBuyerProfile(value: unknown): UpdateBuyerProfileRequest {
  const channel = 'buyerProfile:update'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    ['projectId', 'pageId', 'who', 'environment', 'segments', 'triggers', 'values', 'poorFit'],
    ['who', 'environment', 'segments', 'triggers', 'values', 'poorFit']
  )
  const request: UpdateBuyerProfileRequest = {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel)
  }
  if (has(record, 'who')) request.who = readPlain(record.who, channel, 8000)
  if (has(record, 'environment')) {
    request.environment = readParagraphs(record.environment, channel, 8000)
  }
  if (has(record, 'segments')) request.segments = readNamed(record.segments, channel)
  if (has(record, 'triggers')) request.triggers = readTextList(record.triggers, channel)
  if (has(record, 'values')) request.values = readTextList(record.values, channel)
  if (has(record, 'poorFit')) request.poorFit = readNamed(record.poorFit, channel)
  return request
}

export function parseAddPrompt(value: unknown): AddPromptRequest {
  const channel = 'prompts:add'
  const record = plain(value, channel)
  requireKeys(record, channel, [
    'projectId',
    'pageId',
    'label',
    'text',
    'source',
    'intentStage',
    'mappedElement'
  ])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    label: readLabel(record.label, channel, 160),
    text: readPromptText(record.text, channel),
    source: readSource(record.source, channel),
    intentStage: readStage(record.intentStage, channel),
    mappedElement: readLabel(record.mappedElement, channel, 300)
  }
}

export function parseEditPrompt(value: unknown): EditPromptRequest {
  const channel = 'prompts:edit'
  const record = plain(value, channel)
  requireKeys(
    record,
    channel,
    [
      'projectId',
      'pageId',
      'promptId',
      'label',
      'source',
      'intentStage',
      'mappedElement',
      'variant'
    ],
    ['label', 'source', 'intentStage', 'mappedElement', 'variant']
  )
  const request: EditPromptRequest = {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel)
  }
  if (has(record, 'label')) request.label = readLabel(record.label, channel, 160)
  if (has(record, 'source')) request.source = readSource(record.source, channel)
  if (has(record, 'intentStage')) request.intentStage = readStage(record.intentStage, channel)
  if (has(record, 'mappedElement')) {
    request.mappedElement = readLabel(record.mappedElement, channel, 300)
  }
  if (has(record, 'variant')) request.variant = readVariant(record.variant, channel)
  return request
}

export function parseRewordPrompt(value: unknown): RewordPromptRequest {
  const channel = 'prompts:reword'
  const record = plain(value, channel)
  requireKeys(record, channel, [
    'projectId',
    'pageId',
    'promptId',
    'marketId',
    'text',
    'allMarkets'
  ])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel),
    marketId: readId(record.marketId, channel),
    text: readPromptText(record.text, channel),
    allMarkets: readBoolean(record.allMarkets, channel)
  }
}

/** Most questions one `prompts:addQuestions` call takes. */
export const MAX_ADD_QUESTIONS = 50

export function parseAddQuestions(value: unknown): AddQuestionsRequest {
  const channel = 'prompts:addQuestions'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'questions'])
  const list = record.questions
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ADD_QUESTIONS) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    questions: list.map((entry) => readNewQuestion(entry, channel))
  }
}

function readNewQuestion(value: unknown, channel: string): NewQuestion {
  const record = plain(value, channel)
  const optional = ['intentStage', 'source', 'mappedElement']
  requireKeys(record, channel, ['text', ...optional], optional)
  const question: NewQuestion = { text: readPromptText(record.text, channel) }
  if (has(record, 'intentStage')) question.intentStage = readStage(record.intentStage, channel)
  if (has(record, 'source')) question.source = readSource(record.source, channel)
  if (has(record, 'mappedElement')) {
    const mapped = record.mappedElement
    if (typeof mapped !== 'string' || mapped.length > 300 || hasControl(mapped)) {
      throw new IpcRequestError(channel)
    }
    question.mappedElement = mapped
  }
  return question
}

export function parsePromptId(
  value: unknown,
  channel: string
): { projectId: string; pageId: string; promptId: string } {
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'promptId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel)
  }
}

export function parseSetPromptEnabled(value: unknown): SetPromptEnabledRequest {
  const channel = 'prompts:setEnabled'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'promptId', 'enabled'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptId: readId(record.promptId, channel),
    enabled: readBoolean(record.enabled, channel)
  }
}

export function parseReorderPrompts(value: unknown): ReorderPromptsRequest {
  const channel = 'prompts:reorder'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'promptIds'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    promptIds: readIdList(record.promptIds, channel)
  }
}

function parseOptionalTemplate(
  value: unknown,
  channel: string
): GenerateBuyerProfileRequest & GeneratePromptsRequest {
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'templateId'], ['templateId'])
  const request: GenerateBuyerProfileRequest = {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel)
  }
  if (has(record, 'templateId')) request.templateId = readId(record.templateId, channel)
  return request
}

/** A list of market drafts (`pages:add`, `pages:update`, Project settings › Markets). */
export function readMarkets(value: unknown, channel: string): MarketDraft[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  return value.map((entry) => {
    const record = plain(entry, channel)
    requireKeys(record, channel, ['country', 'language', 'location', 'device', 'localWording'])
    return {
      country: readCountry(record.country, channel),
      language: readLanguage(record.language, channel),
      location: readNullableLabel(record.location, channel, 120),
      device: readDevice(record.device, channel),
      localWording: readBoolean(record.localWording, channel)
    }
  })
}

function readVariant(value: unknown, channel: string): { marketId: string; text: string } {
  const record = plain(value, channel)
  requireKeys(record, channel, ['marketId', 'text'])
  return { marketId: readId(record.marketId, channel), text: readPromptText(record.text, channel) }
}

function readNamed(value: unknown, channel: string): { name: string; reason: string }[] {
  if (!Array.isArray(value) || value.length === 0) throw new IpcRequestError(channel)
  return value.map((entry) => {
    const record = plain(entry, channel)
    requireKeys(record, channel, ['name', 'reason'])
    return {
      name: readLabel(record.name, channel, 200),
      reason: readPlain(record.reason, channel, 2000)
    }
  })
}

function readTextList(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new IpcRequestError(channel)
  return value.map((entry) => readPlain(entry, channel, 2000))
}

function readIdList(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new IpcRequestError(channel)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    const id = readId(entry, channel)
    if (seen.has(id)) throw new IpcRequestError(channel)
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function readPromptText(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 2000 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readSuppliedText(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 500_000 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readSearchQuery(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 200 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readReader(value: unknown, channel: string): PageReadReader {
  if (typeof value !== 'string' || !isPageReadReader(value)) throw new IpcRequestError(channel)
  return value
}

function readSource(value: unknown, channel: string): PromptSource {
  if (typeof value !== 'string' || !isPromptSource(value)) throw new IpcRequestError(channel)
  return value
}

function readStage(value: unknown, channel: string): IntentStage {
  if (typeof value !== 'string' || !isIntentStage(value)) throw new IpcRequestError(channel)
  return value
}

function readProjectStatus(value: unknown, channel: string): ProjectStatus {
  if (typeof value !== 'string' || !isProjectStatus(value)) throw new IpcRequestError(channel)
  return value
}

function readPageWorkingStatus(
  value: unknown,
  channel: string
): 'setting_up' | 'tracked' | 'paused' {
  if (value !== 'setting_up' && value !== 'tracked' && value !== 'paused') {
    throw new IpcRequestError(channel)
  }
  return value
}

function readInterval(value: unknown, channel: string): IntervalDays {
  if (typeof value !== 'number' || !isIntervalDays(value)) throw new IpcRequestError(channel)
  return value
}

function readSamples(value: unknown, channel: string): SampleCount {
  if (typeof value !== 'number' || !isSampleCount(value)) throw new IpcRequestError(channel)
  return value
}

function readPromptCount(value: unknown, channel: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > MAX_PROMPT_COUNT) {
    throw new IpcRequestError(channel, `The maximum prompt count is ${MAX_PROMPT_COUNT}.`)
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readHttpUrl(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new IpcRequestError(channel)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new IpcRequestError(channel)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IpcRequestError(channel)
  if (url.username !== '' || url.password !== '') throw new IpcRequestError(channel)
  return url.href
}

function readDomain(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const domain = value.trim().toLowerCase()
  if (!DOMAIN.test(domain) || domain.length > 253) throw new IpcRequestError(channel)
  return domain
}

function readCountry(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !isCountryCode(value)) throw new IpcRequestError(channel)
  return value
}

function readLanguage(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !isLanguageTag(value)) throw new IpcRequestError(channel)
  return value
}

function readDevice(value: unknown, channel: string): MarketDevice {
  if (typeof value !== 'string' || !isMarketDevice(value)) throw new IpcRequestError(channel)
  return value
}

function readBoolean(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function readLabel(value: unknown, channel: string, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value
  ) {
    throw new IpcRequestError(channel)
  }
  if (hasControl(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableLabel(value: unknown, channel: string, max: number): string | null {
  if (value === null) return null
  return readLabel(value, channel, max)
}

function readPlain(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max || hasControl(trimmed)) {
    throw new IpcRequestError(channel)
  }
  return trimmed
}

/** Like readPlain, but line breaks stay: the environment is one point per line. */
function readParagraphs(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const trimmed = value.replace(/\r\n?/gu, '\n').trim()
  if (trimmed.length === 0 || trimmed.length > max || hasControl(trimmed.replace(/\n/gu, ' '))) {
    throw new IpcRequestError(channel)
  }
  return trimmed
}

function readNameList(value: unknown, channel: string, required: boolean): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  if (required && value.length === 0) throw new IpcRequestError(channel)
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of value) {
    const name = readLabel(entry, channel, 80)
    if (seen.has(name)) throw new IpcRequestError(channel)
    seen.add(name)
    names.push(name)
  }
  return names
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableId(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readId(value, channel)
}

function plain(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function requireKeys(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[],
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of allowed) {
    if (optional.includes(key)) continue
    if (!has(record, key)) throw new IpcRequestError(channel)
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
