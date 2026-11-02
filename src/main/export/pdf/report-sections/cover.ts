import { grouped, type BlockContext } from '../blocks'
import { promptsTrackedText } from '@shared/report-copy'

/** Section 1, the cover: what the report covers, when, and for whom. */

const TEMPLATE_KINDS: Record<string, string> = {
  buyer_prompts: 'Buyer prompts',
  coverage: 'Coverage matrix',
  answer_shape: 'Answer shape',
  brand_sentiment: 'Brand sentiment'
}

export function coverBlocks(context: BlockContext): void {
  const { model, pdf, say } = context
  const cover = model.cover
  const hide = pdf.hideBranding
  const facts: { label: string; value: string }[] = []
  const prepared = preparedFor(pdf.preparedFor, cover.clientName)
  if (prepared !== null) facts.push({ label: 'Prepared for', value: say(prepared) })
  facts.push({ label: 'Built', value: context.date(cover.builtAt) })
  facts.push({
    label: 'Data window',
    value:
      cover.windowFrom === null || cover.windowTo === null
        ? 'No finished checks in range'
        : `${context.date(cover.windowFrom)} to ${context.date(cover.windowTo)}`
  })
  facts.push({
    label: model.markets.length === 1 ? 'Market' : 'Markets',
    value:
      model.markets.length === 0
        ? 'None'
        : model.markets.map((market) => context.marketLabel(market.id)).join(', ')
  })
  facts.push({
    label: 'Prompts tracked',
    value: promptsTrackedText(cover.promptsTracked, model.markets.length)
  })
  facts.push({ label: 'Tracked pages', value: grouped(cover.trackedPages) })
  facts.push({
    label: 'Brands looked for',
    value: cover.brands.length === 0 ? 'None set' : say(cover.brands.join(', '))
  })
  if (cover.competitors.length > 0) {
    facts.push({ label: 'Competitors', value: say(cover.competitors.join(', ')) })
  }
  if (cover.templates.length > 0) {
    facts.push({
      label: 'Templates used',
      value: say(cover.templates.map((template) => templateLine(template, hide)).join('; '))
    })
  }
  facts.push({ label: 'Time zone', value: say(cover.timeZone) })
  context.blocks.push({
    kind: 'cover',
    eyebrow: say(`AI Overview visibility · ${cover.domain}`),
    title: say(cover.title),
    scope: say(cover.scopeLabel),
    facts
  })
}

export function preparedFor(value: string | null, clientName: string | null): string | null {
  for (const candidate of [value, clientName]) {
    const trimmed = candidate?.trim() ?? ''
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function templateLine(
  template: { kind: string; name: string; hash: string },
  hide: boolean
): string {
  const kind = TEMPLATE_KINDS[template.kind] ?? template.kind
  const name = hide ? template.name.replace(/CiteFox\s*/gi, '').trim() || 'default' : template.name
  return `${kind}: ${name} (${template.hash.slice(0, 8)})`
}
