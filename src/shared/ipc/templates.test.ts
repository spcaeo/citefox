import { describe, expect, test } from 'vitest'
import type { GenerationTemplate } from '../domain'
import {
  callIpcHandler,
  isIpcChannel,
  isIpcInvokeChannel,
  isPlaygroundSavePart,
  isTemplateErrorChannel,
  isTemplateErrorCode,
  PLAYGROUND_SAVE_PARTS,
  TEMPLATE_ERROR_MESSAGES,
  type GenerateBuyerProfileRequest,
  type GenerateCoverageRequest,
  type GeneratePromptsRequest,
  type IpcHandlerMap,
  type IpcResult,
  type PlaygroundRunResult,
  type TemplateUsage
} from './index'
import { handlersReturning, type SameKeys } from './test-fixtures'

type UsageShape = SameKeys<
  keyof TemplateUsage,
  'templateId' | 'buyerProfiles' | 'promptSets' | 'coverageMatrices' | 'lastUsedAt'
>

type TemplateShape = SameKeys<
  keyof GenerationTemplate,
  | 'id'
  | 'kind'
  | 'name'
  | 'notes'
  | 'body'
  | 'isShipped'
  | 'isDefault'
  | 'templateHash'
  | 'createdAt'
  | 'updatedAt'
  | 'version'
  | 'deletedAt'
  | 'variables'
  | 'warnings'
  | 'settings'
>

type ResetDeprecated = 'templates:reset' extends keyof IpcHandlerMap ? true : never

type PlaygroundIsMany =
  IpcResult<'playground:run'> extends readonly PlaygroundRunResult[] ? true : never

type SelectionOptional = [
  'templateId' extends keyof GenerateBuyerProfileRequest ? true : never,
  'templateId' extends keyof GeneratePromptsRequest ? true : never,
  'templateId' extends keyof GenerateCoverageRequest ? true : never
] extends [true, true, true]
  ? true
  : never

const templateContractShape: UsageShape &
  TemplateShape &
  ResetDeprecated &
  PlaygroundIsMany &
  SelectionOptional = true

describe('IPC contract: templates and playground', () => {
  test('playground save parts are the five named pieces', () => {
    expect([...PLAYGROUND_SAVE_PARTS]).toEqual([
      'pageRead',
      'buyerProfile',
      'prompts',
      'coverage',
      'aioChecks'
    ])
    expect(isPlaygroundSavePart('aioChecks')).toBe(true)
    expect(isPlaygroundSavePart('template')).toBe(false)
  })

  test('named templates replace reset, and usage counts saved artifacts only', () => {
    expect(templateContractShape).toBe(true)
    expect(isIpcChannel('templates:reset')).toBe(true)
    expect(isIpcInvokeChannel('templates:reset')).toBe(true)
    expect(isIpcInvokeChannel('templates:create')).toBe(true)
    expect(isIpcInvokeChannel('templates:delete')).toBe(true)
    expect(isIpcInvokeChannel('templates:restore')).toBe(true)
    expect(isIpcInvokeChannel('templates:setDefault')).toBe(true)
    expect(isIpcInvokeChannel('templates:usage')).toBe(true)
    expect(isTemplateErrorCode('default_in_use')).toBe(true)
    expect(isTemplateErrorCode('shipped_readonly')).toBe(true)
    expect(isTemplateErrorCode('playground_runs')).toBe(false)
    expect(isTemplateErrorChannel('templates:usage')).toBe(true)
    expect(isTemplateErrorChannel('gaps:redo')).toBe(true)
    expect(isTemplateErrorChannel('templates:reset')).toBe(false)
    expect(TEMPLATE_ERROR_MESSAGES.default_in_use).toBe(
      'Set another template as the default before deleting this one.'
    )
    expect(TEMPLATE_ERROR_MESSAGES.shipped_readonly).toContain('read-only')

    const usage: TemplateUsage = {
      templateId: 'tpl-buyer',
      buyerProfiles: 2,
      promptSets: 1,
      coverageMatrices: 0,
      lastUsedAt: null
    }
    expect(Object.keys(usage).sort()).toEqual([
      'buyerProfiles',
      'coverageMatrices',
      'lastUsedAt',
      'promptSets',
      'templateId'
    ])
    expect(Object.hasOwn(usage, 'playgroundRuns')).toBe(false)

    const handlers = handlersReturning({
      'templates:usage': (request) => ({
        templateId: request.id,
        buyerProfiles: request.projectId === undefined ? 4 : 1,
        promptSets: 0,
        coverageMatrices: 0,
        lastUsedAt: null
      })
    })
    expect(callIpcHandler(handlers, 'templates:usage', [{ id: 'tpl-buyer' }])).toMatchObject({
      buyerProfiles: 4
    })
    expect(
      callIpcHandler(handlers, 'templates:usage', [{ id: 'tpl-buyer', projectId: 'textbolt' }])
    ).toMatchObject({ buyerProfiles: 1 })
    expect(() => callIpcHandler(handlers, 'templates:list', [])).toThrow(/unexpected arguments/)
  })
})
