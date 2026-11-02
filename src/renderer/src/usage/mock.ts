import type { LlmCallRecord, LlmUsage, LlmUsageRequest } from '@shared/ipc'

/** Sample call log for the dev harness and the mock e2e build. Never a release build. */

function call(
  patch: Partial<LlmCallRecord> & Pick<LlmCallRecord, 'id' | 'startedAt'>
): LlmCallRecord {
  return {
    projectId: 'textbolt',
    connection: 'claude-code',
    model: null,
    source: 'assist',
    templateKind: null,
    templateId: null,
    templateHash: null,
    assistId: null,
    durationMs: 6000,
    tokensIn: 3200,
    tokensOut: 540,
    ok: true,
    error: null,
    ...patch
  }
}

const RECENT: readonly LlmCallRecord[] = [
  call({ id: 'c5', startedAt: '2026-10-19T13:52:00.000Z', assistId: 'results.explainChange' }),
  call({
    id: 'c4',
    startedAt: '2026-10-19T13:40:00.000Z',
    source: 'report',
    templateKind: 'run_summary',
    durationMs: 9000,
    tokensIn: 8100,
    tokensOut: 900
  }),
  call({
    id: 'c3',
    startedAt: '2026-10-19T11:05:00.000Z',
    assistId: 'prompts.more',
    ok: false,
    error: 'CiteFox AI hit its usage limit. Try again after it resets.',
    tokensIn: 0,
    tokensOut: 0
  }),
  call({
    id: 'c2',
    startedAt: '2026-10-19T09:14:00.000Z',
    connection: 'anthropic-api',
    model: 'claude-sonnet-5-5',
    source: 'pipeline',
    templateKind: 'buyer_prompts',
    durationMs: 21000,
    tokensIn: 14200,
    tokensOut: 2600
  }),
  call({
    id: 'c1',
    startedAt: '2026-10-19T09:10:00.000Z',
    source: 'pipeline',
    templateKind: 'buyer_profile',
    durationMs: 18000,
    tokensIn: 12800,
    tokensOut: 1900
  })
]

export async function mockLlmUsage(request: LlmUsageRequest): Promise<LlmUsage> {
  const recent =
    request.projectId === undefined
      ? RECENT
      : RECENT.filter((entry) => entry.projectId === request.projectId)
  return {
    builtAt: '2026-10-19T14:00:00.000Z',
    callsToday: 31,
    failedToday: 1,
    callsThisMonth: 412,
    tokensInThisMonth: 1_284_000,
    tokensOutThisMonth: 196_400,
    byConnection: [
      { connection: 'claude-code', calls: 377, tokensIn: 1_042_000, tokensOut: 158_200 },
      { connection: 'anthropic-api', calls: 35, tokensIn: 242_000, tokensOut: 38_200 }
    ],
    byStep: [
      { step: 'buyer_prompts', calls: 96, failed: 0, averageDurationMs: 21_400 },
      { step: 'buyer_profile', calls: 48, failed: 0, averageDurationMs: 17_800 },
      { step: 'run_summary', calls: 120, failed: 2, averageDurationMs: 8_600 },
      { step: 'results.explainChange', calls: 64, failed: 0, averageDurationMs: 6_100 },
      { step: 'prompts.more', calls: 52, failed: 1, averageDurationMs: 11_900 },
      { step: 'other', calls: 32, failed: 0, averageDurationMs: 4_200 }
    ],
    recent,
    recentErrors: recent.filter((entry) => !entry.ok)
  }
}
