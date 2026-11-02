import type { ApiKeyMetadata } from '@shared/domain'
import type { ProjectDetail, ProjectSettingsView } from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import type { AlertsClient } from '../alerts/client'
import type { ProjectScheduleRow } from '../alerts/model'
import type { ShellClient } from '../projects/client'
import type { TemplatesClient } from '../templates/client'
import type { ProjectRulesSource } from './rulesClient'
import type { EnginesSettingsSource } from './track/source'
import type { BrandingClient } from './utils/branding'

export interface ProjectSettingsProps {
  client: ShellClient
  admin: AdminClient
  alertsClient: AlertsClient
  templatesClient: TemplatesClient
  project: ProjectDetail | null
  projects: readonly ProjectDetail[]
  /** Every project's cadence, for the note under Schedule. */
  projectSchedules?: readonly ProjectScheduleRow[]
  keys: readonly ApiKeyMetadata[]
  onChanged: () => Promise<void>
  onDeleted: (activeProjectId: string | null) => Promise<void>
  /** Tests only. Production reads the engines channels on the preload bridge. */
  enginesSource?: EnginesSettingsSource
  /** Tests only. Production reads the project rules channels on the preload bridge. */
  rulesSource?: ProjectRulesSource
  /** Tests only. Production reads `reports:getBranding` on the preload bridge. */
  brandingClient?: BrandingClient
}

/** What every section gets: the loaded view and a way to save and reload it. */
export interface SectionProps {
  view: ProjectSettingsView
  admin: AdminClient
  client: ShellClient
  keys: readonly ApiKeyMetadata[]
  /** Re-reads the settings view and the shell's project list. */
  refresh: () => Promise<void>
}

/** A save's outcome for a section's `role="status"` line. */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; text: string }
  | { kind: 'error'; text: string }
