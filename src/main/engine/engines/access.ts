import type { ProviderChoice, ProviderPlanPrice, SearchProvider } from '@shared/domain'
import type { QueueProjectInput } from '../../queue/types'
import { monthKey } from '../../scheduler/local-time'
import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import { readEngineSettings } from '../../storage/engine-records'
import { readEffectiveScheduleCap } from '../../storage/project-schedule'
import type { ProjectRecord } from '../../storage/records'
import { keyPricing } from '../checks/engines-plan'
import { loadRotationKeys, rotationMode } from '../checks/key-rotation'

/** What a project may use right now: its keys of each provider and their plans. */
export interface EngineAccess {
  cloroReady: boolean
  serpapiReady: boolean
  /** Who runs the Google AI Overview search for this setting (the saved one when null). */
  providerFor(choice: ProviderChoice | null): SearchProvider
  /** The plan of the first key in rotation, else the provider's default plan. */
  planFor(provider: SearchProvider): ProviderPlanPrice
}

export function engineAccess(
  storage: AppStorage,
  project: ProjectRecord,
  db: SqliteDatabase,
  now: Date,
  zone: string
): EngineAccess {
  const cap = readEffectiveScheduleCap(db, monthKey(now.getTime(), zone))
  const queueProject: QueueProjectInput = {
    projectId: project.id,
    name: project.name,
    cap: cap.cap,
    capRule: cap.capRule,
    dedicatedKeyId: cap.dedicatedKeyId,
    paused: false
  }
  const mode = rotationMode(storage)
  const cloroKeys = loadRotationKeys(storage, queueProject, mode, 'cloro')
  const serpKeys = loadRotationKeys(storage, queueProject, mode, 'serpapi')
  const pricing = keyPricing(storage)
  const saved = readEngineSettings(db).provider
  return {
    cloroReady: cloroKeys.length > 0,
    serpapiReady: serpKeys.length > 0,
    providerFor(choice) {
      const setting = choice ?? saved
      if (setting !== 'auto') return setting
      return cloroKeys.length > 0 ? 'cloro' : 'serpapi'
    },
    planFor(provider) {
      const first = provider === 'cloro' ? cloroKeys[0] : serpKeys[0]
      return pricing.planFor(first?.keyId ?? null, provider)
    }
  }
}
