/** First-run onboarding: the profile step, the first project, and finish. */

import { existsSync, rmSync } from 'node:fs'
import type { AppSettings } from '@shared/domain'
import type {
  IpcHandlersFor,
  OnboardingDraft,
  onboardingChannels,
  OnboardingState
} from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import { saveFillCatalog } from '../engine/products'
import { allocateProjectSlug } from '../engine/slug'
import { IpcRequestError, parseSaveProfile } from '../ipc-request'
import { matchSerpApiLocation } from '../locations'
import {
  clearOnboardingDraft,
  OnboardingDraftError,
  parseOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft
} from '../storage/onboarding-draft'
import { buildOnboardingState } from '../onboarding-state'
import { finishSetup, hasSearchKey, parseFinishSetup } from '../onboarding/finish-setup'
import {
  parseSectionEstimate,
  parseSectionPrompt,
  parseSectionRead,
  parseSectionRun
} from '../onboarding/sections/parse'
import {
  estimateSection,
  promptSection,
  readSection,
  runSection
} from '../onboarding/sections/service'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import {
  readProjectProfile,
  writeProjectProfile,
  type ProjectProfile
} from '../storage/project-profile'
import {
  getLatestClaudeCheckup,
  insertProject,
  listApiKeys,
  listProjects,
  readActiveProjectId,
  readOnboardingFinished,
  updateProject,
  writeActiveProjectId,
  writeOnboardingFinished,
  type ProjectRecord
} from '../storage/records'
import { projectDatabasePath, projectDatabaseRelativePath } from '../storage/slug'
import { guard, type EngineContext } from './context'

export function onboardingHandlers(
  ctx: EngineContext,
  checks: CheckEngine | null = null
): IpcHandlersFor<typeof onboardingChannels> {
  return {
    'onboarding:getState': () => guard('onboarding:getState', ctx, () => readOnboarding(ctx)),
    'onboarding:saveProfile': (request) =>
      guard('onboarding:saveProfile', ctx, () => saveProfile(ctx, request)),
    'onboarding:finish': () => guard('onboarding:finish', ctx, () => finishOnboarding(ctx)),
    'onboarding:getDraft': () => guard('onboarding:getDraft', ctx, () => readDraft(ctx)),
    'onboarding:saveDraft': (request) =>
      guard('onboarding:saveDraft', ctx, () => saveDraft(ctx, request)),
    // Onboarding v2 section cards (Docs/ONBOARDING.md).
    'onboarding:sectionEstimate': (request) =>
      guard('onboarding:sectionEstimate', ctx, () =>
        estimateSection(ctx, parseSectionEstimate(request))
      ),
    'onboarding:sectionPrompt': (request) =>
      guard('onboarding:sectionPrompt', ctx, () => promptSection(ctx, parseSectionPrompt(request))),
    'onboarding:sectionRun': (request) =>
      guard('onboarding:sectionRun', ctx, () => runSection(ctx, parseSectionRun(request))),
    'onboarding:sectionRead': (request) =>
      guard('onboarding:sectionRead', ctx, () => readSection(ctx, parseSectionRead(request))),
    'onboarding:finishSetup': (request) =>
      guard('onboarding:finishSetup', ctx, () =>
        finishSetup(ctx, checks, parseFinishSetup(request), () => readOnboarding(ctx))
      )
  }
}

/** Docs/FEEDBACK.md batch 2 row 4: the step and typed fields survive a restart. */
function readDraft(ctx: EngineContext): OnboardingDraft | null {
  if (readOnboardingFinished(ctx.storage.db)) return null
  return readOnboardingDraft(ctx.storage.paths.onboardingDraftFile)
}

function saveDraft(ctx: EngineContext, request: unknown): { saved: boolean } {
  let draft: OnboardingDraft
  try {
    draft = parseOnboardingDraft(request)
  } catch (error) {
    if (error instanceof OnboardingDraftError) {
      throw new IpcRequestError('onboarding:saveDraft')
    }
    throw error
  }
  // A late save after Finish must not bring the draft back.
  if (readOnboardingFinished(ctx.storage.db)) return { saved: false }
  writeOnboardingDraft(ctx.storage.paths.onboardingDraftFile, draft)
  return { saved: true }
}

function readOnboarding(ctx: EngineContext): OnboardingState {
  const settings = ctx.storage.readSettings()
  const project = listProjects(ctx.storage.db)[0] ?? null
  const profile = project === null ? null : readProfile(ctx, project)
  const keys = listApiKeys(ctx.storage.db)
  return buildOnboardingState({
    finished: readOnboardingFinished(ctx.storage.db),
    userName: settings.userName,
    project,
    profile,
    // Either search provider completes the search-key step (cloro or SerpApi).
    hasSerpApiKey: keys.some((key) => key.provider === 'serpapi' || key.provider === 'cloro'),
    hasAnthropicKey: keys.some((key) => key.provider === 'anthropic'),
    hasJinaKey: keys.some((key) => key.provider === 'jina'),
    hasCheckup: getLatestClaudeCheckup(ctx.storage.db) !== null
  })
}

function readProfile(ctx: EngineContext, project: ProjectRecord): ProjectProfile | null {
  const file = projectDatabasePath(ctx.storage.paths.projectsDirectory, project.slug)
  if (!existsSync(file)) return null
  const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, project.slug)
  try {
    return readProjectProfile(db)
  } finally {
    closeProjectDatabase(db)
  }
}

function saveProfile(ctx: EngineContext, request: unknown): OnboardingState {
  const parsed = parseSaveProfile(request)
  const settings = ctx.storage.readSettings()
  // "Your name" is optional in onboarding v2: an empty name keeps the saved one (or none).
  const userName = parsed.userName === '' ? settings.userName : parsed.userName
  const next: AppSettings = { ...settings, userName }
  if (settings.defaultCountry === null) next.defaultCountry = parsed.country
  if (settings.defaultLanguage === null) next.defaultLanguage = parsed.language
  if (settings.defaultLocation === null) next.defaultLocation = parsed.location
  ctx.storage.writeSettings(next)

  const existing = listProjects(ctx.storage.db)[0]
  if (existing === undefined) {
    createFirstProject(ctx, parsed)
  } else {
    updateProject(ctx.storage.db, existing.id, {
      name: parsed.projectName,
      domain: parsed.domain
    })
    const previous = readProfile(ctx, {
      ...existing,
      name: parsed.projectName,
      domain: parsed.domain
    })
    writeProfile(ctx, existing.slug, parsed, previous?.market.id ?? ctx.createId(), previous)
    if (readActiveProjectId(ctx.storage.db) === null) {
      writeActiveProjectId(ctx.storage.db, existing.id)
    }
  }
  return readOnboarding(ctx)
}

function createFirstProject(ctx: EngineContext, parsed: ReturnType<typeof parseSaveProfile>): void {
  const slug = allocateSlug(ctx, parsed.projectName, parsed.domain)
  const db = createProjectDatabase(ctx.storage.paths.projectsDirectory, slug)
  const file = projectDatabasePath(ctx.storage.paths.projectsDirectory, slug)
  try {
    writeProfile(ctx, slug, parsed, ctx.createId(), null, db)
    insertProjectRow(ctx, parsed, slug)
  } catch (error) {
    closeProjectDatabase(db)
    rmSync(file, { force: true })
    rmSync(`${file}-wal`, { force: true })
    rmSync(`${file}-shm`, { force: true })
    throw error
  }
  closeProjectDatabase(db)
}

function insertProjectRow(
  ctx: EngineContext,
  parsed: ReturnType<typeof parseSaveProfile>,
  slug: string
): void {
  const id = ctx.createId()
  insertProject(ctx.storage.db, {
    id,
    name: parsed.projectName,
    slug,
    domain: parsed.domain,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  })
  writeActiveProjectId(ctx.storage.db, id)
}

function writeProfile(
  ctx: EngineContext,
  slug: string,
  parsed: ReturnType<typeof parseSaveProfile>,
  marketId: string,
  previous: ProjectProfile | null,
  alreadyOpen?: ReturnType<typeof createProjectDatabase>
): void {
  const profile: ProjectProfile = {
    includeSubdomains: parsed.includeSubdomains,
    brandNames: parsed.brandNames,
    competitors: parsed.competitors,
    ...(parsed.switchingFrom !== undefined ? { switchingFrom: parsed.switchingFrom } : {}),
    ...(parsed.integrations !== undefined ? { integrations: parsed.integrations } : {}),
    market: {
      id: marketId,
      country: parsed.country,
      language: parsed.language,
      location: parsed.location,
      device: parsed.device,
      localWording: previous?.market.localWording ?? false,
      serpapiLocation: matchSerpApiLocation(parsed.location, parsed.country, ctx.locations)
    }
  }
  if (alreadyOpen !== undefined) {
    writeProjectProfile(alreadyOpen, profile)
    return
  }
  const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, slug)
  try {
    writeProjectProfile(db, profile)
  } finally {
    closeProjectDatabase(db)
  }
}

function allocateSlug(ctx: EngineContext, name: string, domain: string): string {
  return allocateProjectSlug(
    ctx.storage.db,
    ctx.storage.paths.projectsDirectory,
    name,
    domain,
    'onboarding:saveProfile'
  )
}

function finishOnboarding(ctx: EngineContext): OnboardingState {
  const state = readOnboarding(ctx)
  if (state.profile === null || !hasSearchKey(ctx)) {
    throw new IpcRequestError(
      'onboarding:finish',
      'A saved profile and a search key (cloro or SerpApi) are required'
    )
  }
  saveDraftProducts(ctx)
  writeOnboardingFinished(ctx.storage.db, true)
  clearOnboardingDraft(ctx.storage.paths.onboardingDraftFile)
  return readOnboarding(ctx)
}

/**
 * Docs/PROMPT-AUDIT.md PC: the draft's Fill read is the only place its products and
 * competitors-by-product live, and Finish clears the draft. Save the products, and each
 * competitor the user kept by the product (and tier) it was found for. A failure is
 * logged and never blocks Finish: the flat competitor list is already saved.
 */
function saveDraftProducts(ctx: EngineContext): void {
  const fill = readOnboardingDraft(ctx.storage.paths.onboardingDraftFile)?.fill ?? null
  const project = listProjects(ctx.storage.db)[0]
  if (fill === null || project === undefined) return
  if ((fill.products ?? []).length === 0 && fill.competitors.length === 0) return
  try {
    const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, project.slug)
    try {
      const saved = saveFillCatalog(db, fill)
      ctx.logger.info('onboarding products saved', {
        products: saved.products.length,
        competitors: saved.competitors.length
      })
    } finally {
      closeProjectDatabase(db)
    }
  } catch (error) {
    ctx.logger.warn('onboarding products not saved', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    })
  }
}
