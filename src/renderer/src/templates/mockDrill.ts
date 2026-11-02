import type {
  LlmCallList,
  LlmCallsRequest,
  TemplateUsageDetail,
  TemplateUsageItemKind,
  TemplateUsageRequest
} from '@shared/ipc'
import { getM2Memory, type StoredUse } from '../mocks/m2/memory'
import { getTemplate } from '../mocks/m2/templates'

/**
 * Dev and e2e mocks for the Templates drill-downs. Built from the same
 * remembered uses as the mock `templates:usage`, so the counts match.
 */

const ITEM_KIND: Readonly<Record<StoredUse['bucket'], TemplateUsageItemKind>> = {
  buyerProfiles: 'buyer_profile',
  promptSets: 'prompt_set',
  coverageMatrices: 'coverage'
}

const KIND_BUCKET: Readonly<Record<string, StoredUse['bucket']>> = {
  buyer_profile: 'buyerProfiles',
  buyer_prompts: 'promptSets',
  coverage: 'coverageMatrices'
}

export async function mockUsageDetail(request: TemplateUsageRequest): Promise<TemplateUsageDetail> {
  const template = await getTemplate({ id: request.id })
  const items = getM2Memory()
    .uses.filter(
      (use) =>
        use.templateId === request.id &&
        (request.projectId === undefined || use.projectId === request.projectId)
    )
    .map((use) => ({
      id: use.id,
      kind: ITEM_KIND[use.bucket],
      projectId: use.projectId,
      projectName: use.projectId,
      pageId: use.pageId,
      pageLabel: use.pageId,
      pageUrl: '',
      savedAt: use.at,
      templateHash: template.templateHash
    }))
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
  return { templateId: request.id, items }
}

/** One mock call per remembered use of the step's kind. */
export async function mockStepCalls(request: LlmCallsRequest): Promise<LlmCallList> {
  const bucket = KIND_BUCKET[request.templateKind]
  const uses = getM2Memory().uses.filter(
    (use) =>
      bucket !== undefined &&
      use.bucket === bucket &&
      (request.projectId === undefined || use.projectId === request.projectId)
  )
  const calls = await Promise.all(
    uses.map(async (use) => {
      const template = await getTemplate({ id: use.templateId }).catch(() => null)
      return {
        id: `call-${use.id}`,
        projectId: use.projectId,
        connection: 'claude-code' as const,
        model: 'claude-sonnet-5-5',
        source: 'pipeline' as const,
        templateKind: request.templateKind,
        templateId: use.templateId,
        templateHash: template?.templateHash ?? null,
        assistId: null,
        startedAt: use.at,
        durationMs: 12_000,
        tokensIn: 4200,
        tokensOut: 900,
        ok: true,
        error: null
      }
    })
  )
  calls.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return { calls, total: calls.length }
}
