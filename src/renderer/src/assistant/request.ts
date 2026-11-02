import {
  ASSISTANT_ACTION_KINDS,
  type AssistantActionKind,
  type AssistantContextInput,
  type AssistantEntity
} from '@shared/ipc'
import { AI_CONTEXT_LIMITS, type AiContext, type AiEntityRef } from './context/types'

/**
 * The context Ask CiteFox sends with a question: the merged screen context in
 * the shape `assistant:ask` checks. Ids that are not opaque ids are dropped,
 * texts are cut to the limits, so a request is never refused for its context.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
const SCREEN = /^[a-z][a-z0-9.-]*$/
const FILTER_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,39}$/

function id(value: string | null | undefined): string | null {
  return value && ID.test(value) ? value : null
}

function text(value: string, max: number = AI_CONTEXT_LIMITS.text): string {
  const flat = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function toAssistantEntity(item: AiEntityRef): AssistantEntity {
  return {
    kind: item.kind,
    id: id(item.id),
    label: text(item.label) || item.kind,
    detail: item.detail ? text(item.detail) : null
  }
}

export function toAssistantContext(
  context: AiContext,
  about: AiEntityRef | null = null
): AssistantContextInput {
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(context.filters).slice(0, 20)) {
    if (FILTER_KEY.test(key)) filters[key] = text(value, 120)
  }
  const capabilities = context.capabilities.filter((kind): kind is AssistantActionKind =>
    (ASSISTANT_ACTION_KINDS as readonly string[]).includes(kind)
  )
  return {
    screen: SCREEN.test(context.screen) ? context.screen.slice(0, 60) : 'screen',
    screenLabel: text(context.screenLabel, 120) || 'This screen',
    crumbs: context.crumbs.slice(0, 8).map((crumb) => text(crumb, 120)),
    pageId: id(context.pageId),
    topicId: id(context.topicId),
    promptId: id(context.promptId),
    marketId: id(context.marketId),
    runId: id(context.runId),
    about: about ? toAssistantEntity(about) : null,
    entities: context.entities.slice(0, AI_CONTEXT_LIMITS.entities).map(toAssistantEntity),
    selection: context.selection.slice(0, AI_CONTEXT_LIMITS.entities).map(toAssistantEntity),
    filters,
    numbers: context.numbers.slice(0, AI_CONTEXT_LIMITS.numbers).map((number) => ({
      label: text(number.label, 120),
      value: text(number.value, 120),
      drill: number.drill ? number.drill.slice(0, 200) : null
    })),
    facts: context.facts.slice(0, AI_CONTEXT_LIMITS.facts).map((fact) => text(fact)),
    capabilities: [...new Set(capabilities)]
  }
}
