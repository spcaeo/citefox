import type {
  AddQuestionsRequest,
  AddQuestionsResult,
  AssistantAnswer,
  AssistantAskRequest,
  AssistLabel,
  AssistResult,
  AssistRunRequest,
  CheckJob,
  DraftFixResult,
  SetTopicTargetRequest,
  SetTopicTargetResult,
  StartCheckRequest,
  TopicPromptRequest
} from '@shared/ipc'

/**
 * Ask CiteFox for dev and e2e mock builds: fixed answers that show every part
 * of an answer card (sources, an action, an unknown), never a Claude call.
 */

const LABEL: AssistLabel = {
  connection: 'claude-code',
  connectionText: 'CiteFox AI · on your plan',
  expectedSeconds: 8,
  text: 'CiteFox AI · on your plan · about 8 s'
}

export async function mockAsk(request: AssistantAskRequest): Promise<AssistantAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  const promptId =
    request.context.about?.kind === 'question' ? request.context.about.id : request.context.promptId
  const pageId = request.context.topicId ?? request.context.pageId
  return {
    intent: 'explain',
    question: request.question,
    text: `This is a sample answer for ${request.context.screenLabel}. Real answers read your stored checks for the ids on this screen and never search.`,
    draft: null,
    questions: [],
    sources:
      pageId && promptId
        ? [
            {
              kind: request.context.topicId ? 'topic' : 'check',
              label: 'Sample check',
              pageId,
              promptId,
              marketId: request.context.marketId,
              runId: null,
              drill: null,
              domain: null
            }
          ]
        : [],
    actions:
      pageId && promptId
        ? [
            {
              id: 'draft-fix-1',
              kind: 'draft-fix',
              title: 'Draft a fix for this question',
              detail:
                'CiteFox AI drafts it from the stored overview · no searches · you review it first',
              pageId: request.context.topicId ? null : pageId,
              topicId: request.context.topicId,
              promptIds: [promptId],
              marketIds: request.context.marketId ? [request.context.marketId] : [],
              questions: [],
              name: null,
              targetPageId: null,
              searches: null,
              drill: null
            }
          ]
        : [],
    unknowns: ['The overview text for this question'],
    flagged: [],
    basedOn: { checkedThrough: '2026-10-23T10:00:00Z', checks: 4, markets: 2 },
    label: LABEL,
    list: null,
    savedDataOnly: true
  }
}

export async function mockAddQuestions(request: AddQuestionsRequest): Promise<AddQuestionsResult> {
  return {
    pageId: request.pageId,
    promptIds: request.questions.map((_, index) => `mock-q-${index + 1}`),
    skipped: [],
    version: 2,
    savedAt: new Date().toISOString()
  }
}

export async function mockDraftFix(request: TopicPromptRequest): Promise<DraftFixResult> {
  return {
    promptId: request.promptId,
    where: { pageId: null, url: null, newPage: false },
    steps: ['Add an FAQ that answers the question in the buyer’s words.'],
    draft: 'How do I …?\nA sample draft. Facts to confirm are in [brackets].',
    text: 'A sample draft.',
    writeWithUrl: 'https://1000aioverviews.com',
    info: { label: LABEL, durationMs: 0, model: null, searchesUsed: 0 }
  }
}

export async function mockRunAssist(request: AssistRunRequest): Promise<AssistResult> {
  return {
    runId: 'mock-run',
    assistId: request.assistId,
    title: 'Draft the fix',
    summary: null,
    items: [
      {
        id: 'mock-run-1',
        text: 'A sample block to paste.',
        detail: null,
        tag: 'update',
        verify: null,
        sign: null
      }
    ],
    caution: null,
    label: LABEL,
    savedDataOnly: true,
    searchesUsed: 0,
    durationMs: 0,
    model: null
  }
}

export async function mockSetTarget(request: SetTopicTargetRequest): Promise<SetTopicTargetResult> {
  return {
    draft: null,
    rows: request.promptIds.map((promptId) => ({
      promptId,
      targetPageId: request.target?.pageId ?? null,
      targetUrl: request.target?.url ?? null
    }))
  }
}

export async function mockStartCheck(request: StartCheckRequest): Promise<CheckJob> {
  const searches = (request.promptIds?.length ?? 1) * (request.marketIds?.length ?? 1)
  return {
    id: 'mock-job',
    projectId: request.projectId,
    pageIds: request.pageIds,
    marketIds: request.marketIds,
    promptIds: request.promptIds,
    status: 'finished',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    done: searches,
    total: searches,
    searchesUsed: searches,
    searchesMax: searches,
    brandSearchesMax: 0,
    monthUsed: null,
    monthLimit: null,
    runIds: [],
    markets: [],
    steps: [],
    message: null,
    nextStep: null
  }
}
