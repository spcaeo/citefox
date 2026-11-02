import type {
  DeliveryRecord,
  DueList,
  EmailSettings,
  ProjectUsageReport,
  QueueStatus
} from '@shared/domain'
import type {
  AppSettingsSnapshot,
  CheckJob,
  ConnectionsOverview,
  ProjectList,
  StatusCapsule
} from '@shared/ipc'

/** One read of every Status channel. A null part failed to load and says so on screen. */
export interface StatusData {
  capsule: StatusCapsule | null
  overview: ConnectionsOverview | null
  settings: AppSettingsSnapshot | null
  queue: QueueStatus | null
  email: EmailSettings | null
  deliveries: readonly DeliveryRecord[] | null
  /** Check jobs running in every project (`checks:listActive`). */
  jobs: readonly CheckJob[] | null
  /** Pages due in every project (`schedule:listDue`). */
  due: DueList | null
  /** This month's searches per project (`projectSettings:usage`). */
  usage: ProjectUsageReport | null
  /** Project names and the open project (`projects:list`). */
  projects: ProjectList | null
  /** ISO-8601 UTC of the last full read. */
  loadedAt: string
  errors: readonly string[]
}

export type { SerpKeyLine } from '../keys/serpUsage'

/** "At this pace" projection for the month, from searches already recorded. */
export interface UsagePace {
  used: number
  dayOfMonth: number
  daysInMonth: number
  projected: number
  monthEnd: string
}
