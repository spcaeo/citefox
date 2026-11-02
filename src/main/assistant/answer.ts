import type {
  AskAnswer,
  AskRow,
  AssistantAnswer,
  AssistantAskRequest,
  AssistantIntent,
  AssistantSource
} from '@shared/ipc'
import { askQuestion, filterAnswer } from '../ask/answer'
import { checkFactsText, readCheckFacts } from '../ask/help/facts'
import {
  findHelp,
  helpLinksFor,
  helpPromptText,
  isHowQuestion,
  nextStepFor,
  STRONG_HELP_SCORE,
  type HelpHit
} from '../ask/help/retrieve'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { redactString } from '../logging/redact'
import { loadGenerationTemplate, renderTemplate } from '../pipeline/templates'
import {
  actionsFor,
  capabilitiesOf,
  drillSource,
  rowSource,
  sourcesFor,
  startCheck
} from './actions'
import { appAnswer } from './app'
import { askClaude, labelFor } from './claude-call'
import { screenHelp } from './help'
import { routeIntent } from './intent'
import { allowedNumbers, stripUnknownNumbers } from './numbers'
import { buildContextPacket, type ContextPacket, type PacketRow } from './packet'
import {
  businessText,
  dayText,
  historyText,
  numbersText,
  packetVariables,
  questionText,
  screenText
} from './packet-text'
import { INTENT_KIND } from './templates'

/**
 * `assistant:ask` (deep audit crosscut §3.3). Routes the question in code,
 * builds the context packet from the stored checks for the screen's ids,
 * renders that intent's one template, asks Claude, then checks the reply:
 * the shape, the refs, and every number against the packet. A reply with an
 * invented number is asked once more with the problem named; what is still
 * wrong is taken out and reported. "Which questions…" goes to the Ask filter
 * engine, whose answer code writes. Never searches; never writes.
 */

export async function askAssistant(
  host: EngineHost,
  request: AssistantAskRequest
): Promise<AssistantAnswer> {
  const projectId = request.projectId
  // No project open: app-level questions and setup help, from stored app data only.
  if (projectId === null) return appAnswer(host, request)
  const project = { ...request, projectId }
  const how = isHowQuestion(request.question)
  const hits = findHelp(request.question, { screen: request.context.screen })
  const intent = helpIntent(routeIntent(request.question, request.context), request.question, hits)
  if (intent === 'list') return listAnswer(host, project)
  // Help goes with every help answer, and with a data answer to a how / why / where question.
  const helpHits = intent === 'help' || how ? hits : []
  const kind = INTENT_KIND[intent]
  const label = labelFor(host, projectId, kind)
  return withProject(host, projectId, 'assistant:ask', async (opened) => {
    const packet = buildContextPacket(opened.db, opened.project, request.context, host.now())
    const today = host.now().toISOString().slice(0, 10)
    const help = {
      help: helpPromptText(helpHits),
      check_facts: checkFactsText(readCheckFacts(opened.db, projectId), dayText)
    }
    const variables =
      intent === 'help'
        ? {
            business: businessText(packet),
            screen: screenText(request.context, null),
            screen_help: screenHelp(request.context.screen),
            numbers: numbersText(packet),
            history: historyText(request.history),
            question: questionText(request.question),
            today,
            ...help
          }
        : { ...packetVariables(packet, request.question, request.history, today), ...help }
    const template = loadGenerationTemplate(
      host.storage.db,
      kind,
      undefined,
      'templates:get',
      opened.db
    )
    const prompt = redactString(renderTemplate(template.body, variables, kind).text, {
      secrets: host.knownSecrets(),
      hexKeys: true
    })
    const allowed = allowedNumbers(
      prompt,
      ...request.context.numbers.map((item) => `${item.label} ${item.value}`)
    )
    const reply = await askClaude(
      host,
      projectId,
      kind,
      prompt,
      allowed,
      template.id,
      template.templateHash
    )
    const checked = stripUnknownNumbers(reply.text, allowed)
    const links = helpLinksFor(helpHits, reply.sources, intent === 'help')
    return {
      intent,
      question: request.question,
      text: checked.text,
      draft: reply.draft,
      questions: reply.questions,
      sources: [drillSource(request.context), ...sourcesFor(reply.sources, packet)]
        .filter((item): item is AssistantSource => item !== null)
        .slice(0, 8),
      actions:
        intent === 'help'
          ? []
          : actionsFor({ intent, proposed: reply.actions, questions: reply.questions, packet }),
      unknowns: reply.unknowns,
      flagged: checked.flagged,
      basedOn: basedOn(packet),
      label,
      list: null,
      savedDataOnly: true,
      help: links,
      next: nextStepFor(links, helpHits, request.context.screen)
    }
  })
}

/** "Why is What changed empty?": a question about the screen itself, not the rows on it. */
const EMPTY_SCREEN =
  /\b(empty|blank|greyed|grayed|disabled|nothing (shows|there|here)|no (data|results|numbers) (yet|here|there|shown))\b/

/** Intents that answer from the rows only; a screen-state question there goes to help. */
const SCREEN_STATE_INTENTS: ReadonlySet<AssistantIntent> = new Set([
  'explain',
  'changes',
  'why_not_cited',
  'next_steps'
])

/**
 * A how / why / where question goes to the help prompt when a help section
 * clearly answers it and the router left it to "explain" (no number or row
 * named), or it asks why a screen is empty ("Why is What changed empty?").
 * Every other routed intent stays.
 */
export function helpIntent(
  routed: AssistantIntent,
  question: string,
  hits: readonly HelpHit[]
): AssistantIntent {
  if (!isHowQuestion(question) || (hits[0]?.score ?? 0) < STRONG_HELP_SCORE) return routed
  if (routed === 'explain') return 'help'
  const text = question.toLowerCase()
  return SCREEN_STATE_INTENTS.has(routed) && EMPTY_SCREEN.test(text) ? 'help' : routed
}

function basedOn(packet: ContextPacket): AssistantAnswer['basedOn'] {
  return {
    checkedThrough: packet.checkedThrough,
    checks: packet.scopeRows,
    markets: packet.marketIds.length
  }
}

/**
 * "Which questions…": the Ask filter engine (Claude writes filters, code the
 * answer), narrowed to the screen's page or topic and market where Claude
 * left them open.
 */
async function listAnswer(
  host: EngineHost,
  request: AssistantAskRequest & { projectId: string }
): Promise<AssistantAnswer> {
  const first = await askQuestion(host, {
    projectId: request.projectId,
    question: request.question
  })
  const subject = request.context.topicId ?? request.context.pageId
  const narrowPage = first.filters.pageIds === null && subject !== null
  const narrowMarket = first.filters.marketIds === null && request.context.marketId !== null
  let list: AskAnswer = first
  if (first.searched > 0 && (narrowPage || narrowMarket)) {
    const second = await filterAnswer(host, {
      projectId: request.projectId,
      filters: {
        ...first.filters,
        pageIds: narrowPage && subject ? [subject] : first.filters.pageIds,
        marketIds:
          narrowMarket && request.context.marketId
            ? [request.context.marketId]
            : first.filters.marketIds
      }
    })
    list = { ...second, question: first.question, label: first.label, notCovered: first.notCovered }
  }
  const check = startCheck(list.rows.slice(0, 60).map(packetRow))
  const intent: AssistantIntent = 'list'
  return {
    intent,
    question: request.question,
    text: list.answer,
    draft: null,
    questions: [],
    sources: list.rows.slice(0, 5).map((row, index) => rowSource(packetRow(row, index))),
    actions:
      check && capabilitiesOf(request.context).has('start-check')
        ? [{ ...check, id: 'start-check-1' }]
        : [],
    unknowns: list.notCovered ? [list.notCovered] : [],
    flagged: [],
    basedOn: {
      checkedThrough: list.checkedThrough,
      checks: list.searched,
      markets: new Set(list.rows.map((row) => row.marketId)).size
    },
    label: list.label,
    list,
    savedDataOnly: true,
    help: [],
    next: null
  }
}

/** A stored Ask row in the packet's row shape. */
function packetRow(row: AskRow, index: number): PacketRow {
  return {
    ref: `R${index + 1}`,
    pageId: row.pageId,
    pageLabel: row.pageLabel,
    pageKind: row.pageKind ?? 'page',
    pageUrl: row.pageUrl,
    marketId: row.marketId,
    marketLabel: row.marketLabel,
    promptId: row.promptId,
    text: row.promptText,
    stage: row.intentStage,
    status: row.status,
    position: row.position,
    movement: row.movement,
    cited: row.citedDomains,
    checkedAt: row.checkedAt,
    focus: false
  }
}
