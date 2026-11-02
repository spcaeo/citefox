import type { BuyerProfile, BuyerProfileBody } from '@shared/domain'
import type { UpdateBuyerProfileRequest } from '@shared/ipc'
import { PipelineError } from '../pipeline/errors'
import { generateBuyerProfile } from '../pipeline/setup'
import { getLatestBuyerProfile, insertBuyerProfile } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import type { EngineHost } from './host'
import { requirePage } from './page-access'
import { withProject } from './project-db'
import { pageSetupDeps } from './setup-deps'

export function getProfile(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<BuyerProfile | null> {
  return withProject(host, projectId, 'buyerProfile:get', (opened) => {
    requirePage(opened.db, pageId, projectId, 'buyerProfile:get')
    return getLatestBuyerProfile(opened.db, pageId)
  })
}

export function generateProfile(
  host: EngineHost,
  projectId: string,
  pageId: string,
  templateId: string | undefined,
  fresh = false
): Promise<BuyerProfile> {
  const channel = 'buyerProfile:generate'
  return withProject(host, projectId, channel, (opened) => {
    requirePage(opened.db, pageId, projectId, channel)
    const options = {
      ...(templateId === undefined ? {} : { templateId }),
      ...(fresh ? { force: true } : {})
    }
    return generateBuyerProfile(pageSetupDeps(host, opened.db, projectId, channel), pageId, options)
  })
}

export function updateProfile(
  host: EngineHost,
  request: UpdateBuyerProfileRequest
): Promise<BuyerProfile> {
  const channel = 'buyerProfile:update'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    const current = requireProfile(opened.db, request.pageId)
    const saved = insertCopy(host, opened.db, current, {
      who: request.who ?? current.who,
      environment: request.environment ?? current.environment,
      segments: request.segments ?? current.segments,
      triggers: request.triggers ?? current.triggers,
      values: request.values ?? current.values,
      poorFit: request.poorFit ?? current.poorFit
    })
    return saved
  })
}

function requireProfile(db: SqliteDatabase, pageId: string): BuyerProfile {
  const profile = getLatestBuyerProfile(db, pageId)
  if (profile === null) {
    throw new PipelineError('Write the buyer profile before this step.', {
      code: 'not_found',
      nextStep: 'Generate the buyer profile, then try again.'
    })
  }
  return profile
}

function insertCopy(
  host: EngineHost,
  db: SqliteDatabase,
  current: BuyerProfile,
  body: BuyerProfileBody
): BuyerProfile {
  const id = `icp-${host.createId()}`
  insertBuyerProfile(db, {
    ...body,
    id,
    pageId: current.pageId,
    snapshotId: current.snapshotId,
    templateId: current.templateId,
    templateName: current.templateName,
    templateHash: current.templateHash,
    templateUpdatedAt: current.templateUpdatedAt,
    createdAt: host.now().toISOString(),
    promptsStale: false
  })
  const stored = getLatestBuyerProfile(db, current.pageId)
  if (stored === null || stored.id !== id) {
    throw new PipelineError('The buyer profile could not be saved.', {
      code: 'not_found',
      nextStep: 'Read the page again.'
    })
  }
  return stored
}
