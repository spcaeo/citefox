import { createLiveAdminClient, type AdminClient } from '../admin/client'
import { createLiveAlertsClient, type AlertsClient } from '../alerts/client'
import { createAllPagesSource, type AllPagesSource } from '../allPages/source'
import type { ClientMode } from '../onboarding/flags'
import { createIpcShellClient, type ShellClient } from '../projects/client'
import { createLiveReportsClient, type ReportsClient } from '../reports/client'
import { createLiveSchedulesClient, type SchedulesClient } from '../reports/schedulesClient'
import { createQuestionSearchSource, type QuestionSearchSource } from '../shell/questionSearch'

/** The data adapters the shell screens call. */
export interface AppClients {
  shell: ShellClient
  reports: ReportsClient
  alerts: AlertsClient
  schedules: SchedulesClient
  admin: AdminClient
  allPages: AllPagesSource
  /** The top bar search's question lookup. */
  questionSearch: QuestionSearchSource
}

export function createLiveClients(): AppClients {
  return {
    shell: createIpcShellClient(),
    reports: createLiveReportsClient(),
    alerts: createLiveAlertsClient(),
    schedules: createLiveSchedulesClient(),
    admin: createLiveAdminClient(),
    allPages: createAllPagesSource(),
    questionSearch: createQuestionSearchSource()
  }
}

/**
 * Live adapters unless the mock was asked for and this build allows it.
 * The guard is `mocksAllowed()` written inline (see that function), so a
 * release build has no mock chunk at all.
 */
export async function loadAppClients(mode: ClientMode): Promise<AppClients> {
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    const mocks = await import('./mockClients')
    return mocks.createMockClients()
  }
  return createLiveClients()
}
