import { createMockAdminClient } from '../admin/mock'
import { createMockAlertsClient } from '../alerts/mock'
import { createShellAllPagesSource } from '../allPages/shellSource'
import { createMockShellClient } from '../projects/mockClient'
import { createMockReportsClient } from '../reports/mockClient'
import { createMockSchedulesClient } from '../reports/schedulesMock'
import { createShellQuestionSearch } from '../shell/questionSearch'
import type { AppClients } from './clients'

/** In-memory adapters. Only `loadAppClients` imports this, and only when mocks are allowed. */
export function createMockClients(): AppClients {
  const shell = createMockShellClient()
  return {
    shell,
    reports: createMockReportsClient(),
    alerts: createMockAlertsClient(),
    schedules: createMockSchedulesClient(),
    admin: createMockAdminClient(shell),
    allPages: createShellAllPagesSource(shell),
    questionSearch: createShellQuestionSearch(shell)
  }
}
