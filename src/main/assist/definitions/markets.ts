import type { PageResults } from '@shared/domain'
import { statusLabel } from '../../engine/checks/report-files'
import { getPage, listPageMarkets } from '../../storage/pages'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import { AssistInputError, type AssistDefinition } from '../types'
import {
  brandNamesOf,
  formatPrompts,
  marketLabel,
  marketOf,
  pageOf,
  projectOf,
  promptSetOf,
  promptText,
  resultsOf
} from './gather'
import { checkBuyerPrompts } from './rules'

/** Markets screen assists. */

function leaders(results: PageResults): string {
  return (
    results.leaderboard
      .slice(0, 5)
      .map((row) => `${row.domain} (${row.aioCount})`)
      .join(', ') || 'none'
  )
}

function headline(results: PageResults): string {
  const run = results.run
  if (run === null) return 'No check yet.'
  return `Checked ${run.finishedAt ?? 'unknown'}: score ${run.visibilityScore ?? 'none'}, page cited in ${run.pageCited} of ${run.promptsWithAio} overviews, ${run.noAio} prompts with no overview. Sites cited most: ${leaders(results)}.`
}

export const MARKET_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'markets.suggest',
    title: 'Suggest markets',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    minItems: 1,
    maxItems: 5,
    task: `Suggest markets (country, language, and city when it matters) worth adding to this project, from the competitors, the brand, the page language, and the current results.
Do not suggest a market the project already has.
One item per market: text is the market such as "Canada · English · Toronto", detail says why in one or two sentences, tag is the two-letter country code.
Adding a market means future checks spend searches there; say so in caution.`,
    gather(context) {
      const opened = projectOf(context)
      const profile = readProjectProfile(opened.db)
      const markets = listMarkets(opened.db)
      const lines = [
        `Project domain: ${opened.project.domain}`,
        `Brand names: ${profile?.brandNames.join(', ') || '(none saved)'}`,
        `Competitors: ${profile?.competitors.join(', ') || '(none saved)'}`,
        `Markets now: ${markets.map((market) => `${market.id} (${marketLabel(market)})`).join('; ') || 'none'}`
      ]
      const page =
        context.request.pageId === null
          ? null
          : getPage(opened.db, context.request.pageId, opened.project.id)
      if (page !== null) {
        lines.push('', `Page: ${page.url} (${page.title ?? 'no title'})`)
        for (const link of listPageMarkets(opened.db, page.id)) {
          const market = marketOf(opened.db, link.marketId)
          let summary: string
          try {
            summary = headline(resultsOf(context, { ...opened, page }, market.id))
          } catch (error) {
            if (!(error instanceof AssistInputError)) throw error
            summary = 'No check yet.'
          }
          lines.push(`${market.id} (${marketLabel(market)}): ${summary}`)
        }
      }
      return lines.join('\n')
    }
  },
  {
    id: 'markets.localPrompts',
    title: 'Local wording',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId', 'marketId'],
    minItems: 1,
    maxItems: 40,
    task: `Write each saved prompt the way a buyer in the market under "Market" would type it: in that market's language and spelling, with local tools, laws, carriers, and places where they differ.
Keep the same situation and keep it long and situational (8 to 32 words). Never write a brand name from the saved brand names.
One item per prompt, in prompt order: text is the local wording, detail says what changed, tag is "Prompt <number>".`,
    gather(context) {
      const opened = pageOf(context)
      const marketId = context.request.marketId ?? ''
      const market = marketOf(opened.db, marketId)
      const set = promptSetOf(opened.db, opened.page.id)
      const defaultId = opened.page.defaultMarketId
      const lines = set.prompts.map((prompt) => {
        const current = promptText(prompt, marketId)
        const base = promptText(prompt, defaultId)
        return current === base
          ? `Prompt ${prompt.position} (id ${prompt.id}): ${base}`
          : `Prompt ${prompt.position} (id ${prompt.id}): ${base}\n  Saved wording in this market: ${current}`
      })
      return [
        `Market: ${market.id} (${marketLabel(market)})`,
        `Brand names to leave out: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
        '',
        'Prompts in the default market:',
        lines.join('\n')
      ].join('\n')
    },
    check(reply, context) {
      return checkBuyerPrompts(
        reply.items.map((item) => item.text),
        context.db === null ? [] : brandNamesOf(context.db)
      )
    }
  },
  {
    id: 'markets.whatsDifferent',
    title: "What's different here",
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId', 'marketId'],
    minItems: 1,
    maxItems: 8,
    task: `Say what is different in this market's latest results compared with the default market's latest results.
Compare prompt by prompt: overview shown or not, this page cited or not, position, and which sites are cited instead. Note where the wording differs.
summary is two sentences. One item per difference: text is the difference, detail gives the prompt and both statuses, tag is the prompt number such as "Prompt 2".`,
    gather(context) {
      const opened = pageOf(context)
      const marketId = context.request.marketId ?? ''
      const defaultId = opened.page.defaultMarketId
      if (defaultId === null || defaultId === marketId) {
        throw new AssistInputError(
          'This is the default market.',
          'Pick another market to compare with the default.'
        )
      }
      const market = marketOf(opened.db, marketId)
      const base = marketOf(opened.db, defaultId)
      const here = resultsOf(context, opened, market.id)
      const there = resultsOf(context, opened, base.id)
      const rows = here.prompts.map((row) => {
        const other = there.prompts.find((item) => item.promptId === row.promptId)
        const otherText =
          other === undefined
            ? 'not checked'
            : `${statusLabel(other.status)}${other.position === null ? '' : ` #${other.position}`}; cited ${
                other.references
                  .map((ref) => ref.domain)
                  .slice(0, 4)
                  .join(', ') || 'none'
              }`
        return [
          `Prompt ${row.promptPosition} (id ${row.promptId})`,
          `  ${market.id} wording: ${row.text}`,
          `  ${market.id}: ${statusLabel(row.status)}${row.position === null ? '' : ` #${row.position}`}; cited ${
            row.references
              .map((ref) => ref.domain)
              .slice(0, 4)
              .join(', ') || 'none'
          }`,
          `  ${base.id} wording: ${other?.text ?? 'not checked'}`,
          `  ${base.id}: ${otherText}`
        ].join('\n')
      })
      return [
        `This market: ${market.id} (${marketLabel(market)}). ${headline(here)}`,
        `Default market: ${base.id} (${marketLabel(base)}). ${headline(there)}`,
        '',
        rows.join('\n') || 'No prompt results.',
        '',
        'Saved prompts:',
        formatPrompts(promptSetOf(opened.db, opened.page.id).prompts, market.id)
      ].join('\n')
    }
  }
]
