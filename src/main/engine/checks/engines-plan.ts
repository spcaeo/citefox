import {
  ENGINE_IDS,
  isAnswerEngineId,
  providerPlan,
  type AnswerEngineId,
  type EngineId,
  type ProviderChoice,
  type ProviderPlanPrice,
  type SearchProvider
} from '@shared/domain'
import type { QueueProjectInput } from '../../queue/types'
import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import { readEngineSettings, readPageEngines } from '../../storage/engine-records'
import { listApiKeys } from '../../storage/records'
import { loadRotationKeys, rotationMode } from './key-rotation'

/**
 * Who answers a project's Google AI Overview search. `auto` (the default) is cloro when
 * a cloro key the project may use is on, else SerpApi. An explicit choice is kept even
 * with no key of that provider, so the check says which key to add.
 */
export function resolveProvider(
  storage: AppStorage,
  project: QueueProjectInput,
  choice: ProviderChoice
): SearchProvider {
  if (choice !== 'auto') return choice
  return cloroAvailable(storage, project) ? 'cloro' : 'serpapi'
}

/** True when a cloro key the project may use is on. Answer engines need one. */
export function cloroAvailable(storage: AppStorage, project: QueueProjectInput): boolean {
  return loadRotationKeys(storage, project, rotationMode(storage), 'cloro').length > 0
}

/** A page's or topic's engines: its own choice, else the project's. */
export function selectedEngines(db: SqliteDatabase, pageId: string): EngineId[] {
  return readPageEngines(db, pageId) ?? readEngineSettings(db).engines
}

/**
 * The selected engines a check can run now. Google AI Overview runs on either provider;
 * the answer engines need a cloro key. Display order is kept.
 */
export function runnableEngines(selected: readonly EngineId[], withCloro: boolean): EngineId[] {
  return ENGINE_IDS.filter(
    (engine) => selected.includes(engine) && (engine === 'google_aio' || withCloro)
  )
}

export function answerEnginesOf(engines: readonly EngineId[]): AnswerEngineId[] {
  return engines.filter(isAnswerEngineId)
}

/**
 * Prices each key's spend. A cloro key's plan is the plan name the user gave it (Lite
 * when none); a SerpApi key's is that name, else the plan SerpApi reported.
 */
export interface KeyPricing {
  planFor(keyId: string | null, provider: SearchProvider): ProviderPlanPrice
}

export function keyPricing(storage: AppStorage): KeyPricing {
  const keys = new Map(listApiKeys(storage.db).map((key) => [key.id, key]))
  return {
    planFor(keyId, provider) {
      const key = keyId === null ? undefined : keys.get(keyId)
      const name = key?.plan ?? (provider === 'serpapi' ? (key?.serpapiUsage?.plan ?? null) : null)
      return providerPlan(provider, name ?? null)
    }
  }
}
