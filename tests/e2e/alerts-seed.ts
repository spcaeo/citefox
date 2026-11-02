import type { AlertSenders } from '../../src/main/alerts/deliver'
import {
  finishOnboarding,
  openProgressSeed,
  PROGRESS_SEED
} from '../../src/main/handlers/progress.test-helper'
import type { SaveAlertRuleRequest } from '../../src/shared/ipc'

/** Nothing leaves the machine while seeding: every sender only says it worked. */
const QUIET_SENDERS: AlertSenders = {
  desktop: () => undefined,
  email: async () => true,
  slack: async () => true
}

function rule(patch: Partial<SaveAlertRuleRequest>): SaveAlertRuleRequest {
  return {
    projectId: PROGRESS_SEED.projectId,
    id: null,
    name: 'Money pages lose a citation',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: ['ada@example.com', 'lin@example.com'],
    slack: false,
    delivery: 'instant',
    ...patch
  }
}

/**
 * The TextBolt Alerts page from the Progress seed, driven through the real IPC
 * handlers with recorded SerpApi bodies (no network), with two alert rules:
 * - "Money pages lose a citation" (desktop + two emails), which fired once when
 *   the Oct 19 check lost the page's citation on the first question in the US,
 * - "Score drops by 15" (paused), which never fired.
 */
export async function seedAlertsProject(userDataDir: string): Promise<void> {
  const seed = openProgressSeed(userDataDir, { alertSenders: QUIET_SENDERS })
  const [one] = PROGRESS_SEED.prompts
  try {
    await seed.handlers['alerts:saveRule'](rule({}))
    const paused = await seed.handlers['alerts:saveRule'](
      rule({
        name: 'Score drops by 15',
        when: 'score_drop',
        scoreDrop: 15,
        emailTo: [],
        delivery: 'digest'
      })
    )
    await seed.handlers['alerts:setRuleStatus']({
      projectId: PROGRESS_SEED.projectId,
      ids: [paused.id],
      status: 'paused'
    })
    await seed.check(PROGRESS_SEED.first)
    seed.bodies.set(`us|${one.text}`, 'google-competitor.json')
    await seed.check(PROGRESS_SEED.second)
    finishOnboarding(seed.storage)
  } finally {
    seed.close()
  }
}
