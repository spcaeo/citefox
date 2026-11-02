import type { AppSettings, BuyerPrompt } from '@shared/domain'
import type { FillFromWebsiteProgress, PageReadProgress } from '@shared/ipc'
import type { EngineEmail } from '../email/engine-email'
import type { Logger } from '../logging/logger'
import type { AddressLookup } from '../pipeline/fetch-guard'
import type { PageAnchor } from '../pipeline/page-anchors'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import type { BinaryProbe } from '../providers/claude/binary'
import type { SecretStore } from '../secrets/secret-store'
import type { AppStorage } from '../storage/app-storage'
import type { LocationMatch } from '../locations'
import type { SiteOutline } from './site-outline'

/** A prompt draft that has not been saved as a version yet. */
export interface PromptDraftState {
  promptSetId: string | null
  version: number | null
  savedAt: string | null
  icpId: string | null
  templateId: string | null
  templateName: string | null
  templateHash: string | null
  templateUpdatedAt: string | null
  prompts: BuyerPrompt[]
}

export interface EngineMemory {
  drafts: Map<string, PromptDraftState>
  /** The last site read's pages and menu, by bare domain (the products section card). */
  siteOutlines: Map<string, SiteOutline>
}

export interface WebsitePageBody {
  title: string
  text: string
  /** Links on the page, when the reader has them (checks a suggested competitor's domain). */
  links?: readonly string[]
  /** The links with their visible words, when the reader has them (the site menu). */
  anchors?: readonly PageAnchor[]
}

/**
 * What an M2 handler needs from the engine.
 * Secrets stay on `secrets` and are never copied onto a result.
 */
export interface EngineHost {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  claudeCommand: CommandTransport
  claudeProbe: BinaryProbe
  knownSecrets: () => readonly string[]
  now: () => Date
  createId: () => string
  locations: readonly LocationMatch[]
  claude?: ClaudeProvider
  pageDns?: AddressLookup
  readWebsitePage?: (url: string) => Promise<WebsitePageBody | null>
  emitPageReadProgress: (event: PageReadProgress) => void
  emitFillProgress: (event: FillFromWebsiteProgress) => void
  memory: EngineMemory
  settings: () => AppSettings
  /** Email stores and service. `outboxDir` is `<root>/outbox`, built once. */
  email: EngineEmail
}

export function createEngineMemory(): EngineMemory {
  return {
    drafts: new Map(),
    siteOutlines: new Map()
  }
}

export function pageKey(projectId: string, pageId: string): string {
  return `${projectId}\n${pageId}`
}
