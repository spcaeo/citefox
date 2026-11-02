import { isHelpFillBot, isHelpFillWay, type HelpFillBot, type HelpFillWay } from '@shared/helpfill'
import { NEW_TOPIC_WAYS, type NewTopicStep, type NewTopicWay } from '../types'

/**
 * The dialog's state in the hash query, next to `drawer=new-topic` (owner rule: every
 * state has a URL): `draft=<draftId>`, `step=start|questions|pages`,
 * `way=problem|page|questions|competitor`, `questions=<promptId>,<promptId>` (opened
 * from Questions with those ticked) and `topic=<topicId>` (the topic made from them,
 * while its target pages are chosen). "A buyer problem" is the ✦ Help me fill helper:
 * `nt.help=describe|chatbot` and `nt.bot=chatgpt` (prefixed: Add questions, which
 * can open this drawer over it, owns `help` and `bot`).
 */
export interface NewTopicUrl {
  draftId: string | null
  step: NewTopicStep
  way: NewTopicWay | null
  /** Tracked questions picked on the Questions screen (prompt ids). */
  questions: readonly string[]
  topicId: string | null
  /** The helper's way under "A buyer problem"; null: Describe when Claude is set up. */
  help: HelpFillWay | null
  /** The chatbot picked; null: the one used last, else ChatGPT. */
  bot: HelpFillBot | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

function id(value: string | null): string | null {
  return value !== null && ID.test(value) ? value : null
}

function split(hash: string): { path: string; params: URLSearchParams } {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  return at < 0
    ? { path: plain, params: new URLSearchParams() }
    : { path: plain.slice(0, at), params: new URLSearchParams(plain.slice(at + 1)) }
}

/** The dialog's state from a hash. Unknown or malformed values fall back to the default. */
export function parseNewTopicUrl(hash: string): NewTopicUrl {
  const { params } = split(hash)
  const step = params.get('step')
  const way = params.get('way')
  const help = params.get('nt.help')
  const bot = params.get('nt.bot')
  return {
    draftId: id(params.get('draft')),
    step: step === 'questions' || step === 'pages' ? step : 'start',
    way:
      way !== null && (NEW_TOPIC_WAYS as readonly string[]).includes(way)
        ? (way as NewTopicWay)
        : null,
    questions: (params.get('questions') ?? '')
      .split(',')
      .map((item) => id(item.trim()))
      .filter((item): item is string => item !== null)
      .slice(0, 300),
    topicId: id(params.get('topic')),
    help: isHelpFillWay(help) ? help : null,
    bot: isHelpFillBot(bot) ? bot : null
  }
}

/** `hash` with the dialog's values changed; the route and other keys stay. Null removes a key. */
export function withNewTopicUrl(
  hash: string,
  patch: Partial<{
    draftId: string | null
    step: NewTopicStep
    way: NewTopicWay | null
    questions: readonly string[]
    topicId: string | null
    help: HelpFillWay | null
    bot: HelpFillBot | null
  }>
): string {
  const { path, params } = split(hash)
  const set = (key: string, value: string | null): void => {
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }
  if ('draftId' in patch) set('draft', patch.draftId ?? null)
  if ('step' in patch) set('step', patch.step === 'start' ? null : (patch.step ?? null))
  if ('way' in patch) set('way', patch.way ?? null)
  if ('questions' in patch) set('questions', (patch.questions ?? []).join(','))
  if ('topicId' in patch) set('topic', patch.topicId ?? null)
  if ('help' in patch) set('nt.help', patch.help ?? null)
  if ('bot' in patch) set('nt.bot', patch.bot ?? null)
  const query = params.toString()
  return `#${path || '/'}${query ? `?${query}` : ''}`
}
