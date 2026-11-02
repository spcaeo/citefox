import type { AssistantAnswer, AssistantAskRequest } from '@shared/ipc'
import { searchesLeft } from '../connection-status'
import type { EngineHost } from '../engine/host'
import { usageMonth } from '../keys/present'
import { redactString } from '../logging/redact'
import { loadGenerationTemplate, renderTemplate } from '../pipeline/templates'
import { withCountedSearches } from '../storage/key-usage'
import { listApiKeys, listProjects } from '../storage/records'
import { findHelp, helpLinksFor, helpPromptText } from '../ask/help/retrieve'
import { askClaude, labelFor } from './claude-call'
import { screenHelp } from './help'
import { allowedNumbers, stripUnknownNumbers } from './numbers'
import { clean, historyText, questionText, screenText } from './packet-text'

/**
 * Ask CiteFox with no project open (owner ask, W3I-B5): questions about the
 * app itself and setting up. It reads only what CiteFox has stored for the
 * whole app (the project list, the search keys' allowance left) and the
 * shipped screen help, through the one help prompt; never a project's checks,
 * never a search. The answer has no sources and no action cards.
 */

const KIND = 'assistant_help' as const

/** How to start, for the questions people ask before they have a project. */
const SETUP_HELP =
  'Getting started: create a project (its domain and name) from Projects or the Add menu; CiteFox can fill its profile from the website without searches. Then add pages or topics to track and review their buyer questions before any check. Each check uses one CiteFox credit (one search) per question per market; CiteFox AI writes and reads through the AI connection. Both are set up in Connections. Permissions lists what CiteFox needs and why.'

/** What CiteFox has stored for the whole app, as prompt lines. Names are cleaned and capped. */
export function appFacts(host: EngineHost): string {
  const db = host.storage.db
  const projects = listProjects(db).filter((project) => project.status !== 'archived')
  const names = projects
    .slice(0, 12)
    .map((project) => `${clean(project.name, 80)} (${clean(project.domain, 80)})`)
  const keys = listApiKeys(db)
  const serp = keys.filter((key) => key.provider === 'serpapi')
  const left = searchesLeft(withCountedSearches(db, keys, usageMonth(host.now())))
  return [
    'No project is open.',
    projects.length === 0
      ? 'Projects: none yet.'
      : `Projects: ${projects.length} (${names.join('; ')}${projects.length > names.length ? '; …' : ''})`,
    serp.length === 0
      ? 'Search keys: none added yet.'
      : `Search keys: ${serp.length} ${serp.length === 1 ? 'key' : 'keys'}; searches left this month: ${left === null ? 'not known yet' : left}`
  ].join('\n')
}

export async function appAnswer(
  host: EngineHost,
  request: AssistantAskRequest
): Promise<AssistantAnswer> {
  const label = labelFor(host, null, KIND)
  const hits = findHelp(request.question, { screen: request.context.screen })
  const variables = {
    business: appFacts(host),
    screen: screenText(request.context, null),
    screen_help: `${screenHelp(request.context.screen)}\n${SETUP_HELP}`,
    help: helpPromptText(hits),
    check_facts: 'No project is open, so there are no checks.',
    numbers: 'none: no project is open',
    history: historyText(request.history),
    question: questionText(request.question),
    today: host.now().toISOString().slice(0, 10)
  }
  const template = loadGenerationTemplate(host.storage.db, KIND, undefined, 'templates:get')
  const prompt = redactString(renderTemplate(template.body, variables, KIND).text, {
    secrets: host.knownSecrets(),
    hexKeys: true
  })
  const allowed = allowedNumbers(
    prompt,
    ...request.context.numbers.map((item) => `${item.label} ${item.value}`)
  )
  const reply = await askClaude(
    host,
    null,
    KIND,
    prompt,
    allowed,
    template.id,
    template.templateHash
  )
  const checked = stripUnknownNumbers(reply.text, allowed)
  return {
    intent: 'help',
    question: request.question,
    text: checked.text,
    draft: null,
    questions: [],
    sources: [],
    actions: [],
    unknowns: reply.unknowns,
    flagged: checked.flagged,
    basedOn: { checkedThrough: null, checks: 0, markets: 0 },
    label,
    list: null,
    savedDataOnly: true,
    help: helpLinksFor(hits, reply.sources, true),
    next: null
  }
}
