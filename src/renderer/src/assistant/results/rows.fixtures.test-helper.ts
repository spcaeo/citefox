import type { PromptCheckStatus } from '@shared/domain'
import {
  ASK_ROW_LIMIT,
  EMPTY_ASK_FILTERS,
  type AskAnswer,
  type AskChip,
  type AskFilterRequest,
  type AskFilters,
  type AskOptions,
  type AskProjectRequest,
  type AskQuestionRequest,
  type AskRow
} from '@shared/ipc'
import { movementLabel, stageLabel, statusLabel } from '../../m3/model'
import { formatDay } from '../../utils/dates'

/**
 * Dev and e2e-mock stand-in for `ask:*`. A few keywords pick the filters in
 * place of Claude; the matching mirrors the main-process query.
 */

const CHECKED = '2026-10-19T12:00:00.000Z'
const MARKETS = [
  { id: 'mkt-us', label: 'US · EN' },
  { id: 'mkt-uk', label: 'UK · EN' }
] as const
const PAGES = [
  { id: 'page-1', label: 'Text alerts for business' },
  { id: 'page-2', label: 'TextBolt vs SimpleTexting' }
] as const

function row(
  page: 0 | 1,
  market: 0 | 1,
  promptId: string,
  promptText: string,
  status: PromptCheckStatus,
  extra: Partial<AskRow> = {}
): AskRow {
  const pageOption = PAGES[page]
  const marketOption = MARKETS[market]
  return {
    pageId: pageOption.id,
    pageLabel: pageOption.label,
    pageUrl: `https://textbolt.com/${pageOption.id}/`,
    marketId: marketOption.id,
    marketLabel: marketOption.label,
    promptId,
    promptText,
    intentStage: 'problem',
    status,
    position: status === 'page_cited' ? 2 : null,
    movement: 'unchanged',
    citedDomains: ['simpletexting.com', 'twilio.com'],
    checkedAt: CHECKED,
    ...extra
  }
}

const ROWS: readonly AskRow[] = [
  row(
    0,
    0,
    'prompt-1',
    'How can I send text alerts to my employees without a developer?',
    'page_cited',
    {
      citedDomains: ['simpletexting.com', 'textbolt.com', 'twilio.com']
    }
  ),
  row(
    0,
    0,
    'prompt-2',
    'Is there a way to schedule a text to my whole team from Outlook?',
    'not_cited',
    {
      movement: 'lost'
    }
  ),
  row(0, 1, 'prompt-1', 'How can I send text alerts to my staff without a developer?', 'not_cited'),
  row(0, 1, 'prompt-2', 'Can I schedule a text to my whole team from Outlook?', 'other_own_page', {
    position: 1,
    citedDomains: ['textbolt.com']
  }),
  row(
    1,
    0,
    'prompt-3',
    'What is a cheaper alternative for business texting with no developers?',
    'brand_mentioned',
    {
      intentStage: 'comparison'
    }
  ),
  row(1, 1, 'prompt-3', 'Which business texting service is cheaper for a small team?', 'no_aio', {
    intentStage: 'comparison',
    citedDomains: []
  })
]

export function askMockQuestion(request: AskQuestionRequest): AskAnswer {
  const words = request.question.toLowerCase()
  const filters: AskFilters = {
    ...EMPTY_ASK_FILTERS,
    marketIds: /\buk\b/.test(words) ? ['mkt-uk'] : /\bus\b/.test(words) ? ['mkt-us'] : null,
    statuses: words.includes('not cited')
      ? ['not_cited', 'brand_mentioned', 'other_own_page']
      : words.includes('no ai overview')
        ? ['no_aio']
        : null,
    movements: words.includes('lost') ? ['lost'] : null,
    intentStages: words.includes('comparison') ? ['comparison'] : null,
    citedDomain: words.includes('competitor') ? 'simpletexting.com' : null
  }
  return answer(request.question, filters)
}

export function filterMockAnswer(request: AskFilterRequest): AskAnswer {
  return answer(null, request.filters)
}

export function mockAskOptions(request: AskProjectRequest): AskOptions {
  void request
  return {
    pages: PAGES,
    markets: MARKETS,
    domains: ['simpletexting.com', 'textbolt.com', 'twilio.com']
  }
}

function answer(question: string | null, filters: AskFilters): AskAnswer {
  const matched = ROWS.filter((item) => matches(item, filters))
  const text =
    matched.length === 0
      ? `No stored results match these filters. Searched ${ROWS.length} question checks. Remove a filter to see more.`
      : `${matched.length} of ${ROWS.length} question checks match. Latest check ${formatDay(CHECKED, { timeZone: 'UTC' })}.`
  return {
    question,
    filters,
    chips: chips(filters),
    answer: text,
    rows: matched.slice(0, ASK_ROW_LIMIT),
    total: matched.length,
    searched: ROWS.length,
    checkedThrough: CHECKED,
    savedDataOnly: true,
    label:
      question === null
        ? null
        : {
            connection: 'claude-code',
            connectionText: 'CiteFox AI · on your plan',
            expectedSeconds: 5,
            text: 'CiteFox AI · on your plan · about 5 s'
          },
    notCovered:
      question !== null && question.toLowerCase().includes('week')
        ? 'Saved results hold each page’s latest check, so "this week" is read as "since the last check".'
        : null
  }
}

function matches(item: AskRow, filters: AskFilters): boolean {
  if (filters.pageIds && !filters.pageIds.includes(item.pageId)) return false
  if (filters.marketIds && !filters.marketIds.includes(item.marketId)) return false
  if (filters.statuses && !filters.statuses.includes(item.status)) return false
  if (filters.intentStages && !filters.intentStages.includes(item.intentStage)) return false
  if (filters.movements && (item.movement === null || !filters.movements.includes(item.movement))) {
    return false
  }
  const domain = filters.citedDomain
  if (
    domain &&
    !item.citedDomains.some((cited) => cited === domain || cited.endsWith(`.${domain}`))
  ) {
    return false
  }
  const text = filters.text?.toLowerCase()
  if (text && !text.split(/\s+/).every((word) => item.promptText.toLowerCase().includes(word))) {
    return false
  }
  return true
}

function chips(filters: AskFilters): AskChip[] {
  const label = (options: readonly { id: string; label: string }[], id: string): string =>
    options.find((option) => option.id === id)?.label ?? id
  return [
    ...(filters.statuses ?? []).map((value) => ({
      field: 'statuses' as const,
      value,
      label: statusLabel(value)
    })),
    ...(filters.movements ?? []).map((value) => ({
      field: 'movements' as const,
      value,
      label: `${movementLabel(value)} since last check`
    })),
    ...(filters.marketIds ?? []).map((value) => ({
      field: 'marketIds' as const,
      value,
      label: label(MARKETS, value)
    })),
    ...(filters.pageIds ?? []).map((value) => ({
      field: 'pageIds' as const,
      value,
      label: label(PAGES, value)
    })),
    ...(filters.intentStages ?? []).map((value) => ({
      field: 'intentStages' as const,
      value,
      label: `Stage: ${stageLabel(value)}`
    })),
    ...(filters.citedDomain
      ? [
          {
            field: 'citedDomain' as const,
            value: filters.citedDomain,
            label: `Cites ${filters.citedDomain}`
          }
        ]
      : []),
    ...(filters.text
      ? [{ field: 'text' as const, value: filters.text, label: `Contains: ${filters.text}` }]
      : [])
  ]
}
