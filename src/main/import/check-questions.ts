import type { ImportRowCheck, ImportRules, ImportValues } from '@shared/ipc'
import { foldWord, promptKindOf, wordCount, type ImportEntity } from '@shared/import-fields'
import { BUYER_PROMPT_MAX_WORDS, BUYER_PROMPT_MIN_WORDS } from '../pipeline/schemas'
import { MAX_QUESTION_WORDS, namesBrand } from '../topics/text'
import type { ImportDestination, ProjectFacts } from './context'
import { indexed, SimilarIndex } from './similar'
import { checkPageUrl } from './values'

/**
 * Per-row checks for questions and keywords (never one global error): every row
 * gets a result. Exact repeats of a question tracked in the same page or topic, or
 * of an earlier row, are skipped; so is the same question with only a year, an
 * article or a plural changed (`questionMergeKey`), marked `merged`; the same question tracked elsewhere and near
 * duplicates wait for "keep both / use tracked"; short phrases on a topic become
 * keywords; rule breaks (brand, too long, unknown stage or market, another site's
 * page, no room) say how to fix them. Pure over the project facts.
 */

export interface QuestionRowInput {
  values: ImportValues
  keep: boolean
}

interface ListEntry {
  row: number
}

/** The question text of a row: bullets and numbering trimmed, spaces squeezed. */
export function questionText(values: ImportValues): string {
  return (values.question ?? values.keyword ?? '')
    .replace(/^\s*(?:[-*•·]|\d+[.)])\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function clip(text: string, max = 70): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function marketName(facts: ProjectFacts, id: string): string {
  const market = facts.markets.find((item) => item.id === id)
  return market === undefined
    ? id
    : `${market.country.toUpperCase()} · ${market.language.toUpperCase()}`
}

/**
 * A topic named in the Topic column that does not exist yet ("Create it" sets
 * `createTopic`). It is checked in the markets its rows name (W3I-C1), so no
 * project market is refused here.
 */
function newTopicDestination(name: string): ImportDestination {
  return {
    id: `new:${foldWord(name)}`,
    kind: 'topic',
    name,
    marketIds: [],
    count: 0,
    room: 1000,
    url: null
  }
}

export function checkQuestionRows(input: {
  rows: readonly QuestionRowInput[]
  facts: ProjectFacts
  target: ImportDestination | null
  entity: ImportEntity
  rules: ImportRules
}): ImportRowCheck[] {
  const { facts, target, entity, rules } = input
  const list = new SimilarIndex<ListEntry>()
  const used = new Map<string, number>()
  return input.rows.map((row, index): ImportRowCheck => {
    const plain = (
      result: ImportRowCheck['result'],
      reason: string | null,
      fix: ImportRowCheck['fix'] = null,
      match: ImportRowCheck['match'] = null,
      kind: ImportRowCheck['kind'] = 'question'
    ): ImportRowCheck => ({ result, reason, fix, match, kind })
    const text = questionText(row.values)
    if (text.length === 0) return plain('fix', 'No question in this row.', 'empty', null, null)
    const probe = indexed(null, text)
    // Earlier rows first (an exact repeat, or a near one), then this row joins the list.
    const repeat = list.exact(probe)
    const mergedRow = repeat === null ? list.merged(probe) : null
    const nearRow =
      repeat === null && mergedRow === null ? (list.similar(probe)?.item.row ?? null) : null
    list.add({ ...probe, item: { row: index } })

    // Where the row goes: its Topic cell, else the page or topic picked.
    let destination = target
    const topicCell = (row.values.topic ?? '').trim()
    if (topicCell.length > 0 && entity === 'questions') {
      const found = facts.topicsByName.get(foldWord(topicCell)) ?? null
      if (found !== null) destination = found
      else if (row.values.createTopic === '1') destination = newTopicDestination(topicCell)
      else {
        return plain(
          'fix',
          `No topic named “${clip(topicCell, 40)}” yet. Create it, or add the row to the picked topic.`,
          'topic'
        )
      }
    }
    const onPage = destination?.kind === 'page'
    const words = wordCount(text)

    if (repeat !== null) {
      return plain('duplicate', `Same as row ${repeat.row + 1} in this list · skipped.`, null, null)
    }
    if (mergedRow !== null) {
      return {
        ...plain('duplicate', `Same question as row ${mergedRow.row + 1} · merged.`, null, null),
        merged: true
      }
    }
    const own = destination === null ? null : (facts.questionsBySource.get(destination.id) ?? null)
    const exactTracked = own?.exact(probe) ?? null
    const tracked = exactTracked ?? own?.merged(probe) ?? null
    if (tracked !== null && exactTracked === null) {
      return {
        ...plain('duplicate', `Same question as “${clip(tracked.text, 50)}” · merged.`, null, {
          text: tracked.text,
          sourceId: tracked.sourceId,
          sourceName: tracked.sourceName,
          sameTarget: true
        }),
        merged: true
      }
    }
    if (tracked !== null) {
      return plain(
        'duplicate',
        `Already tracked in “${clip(tracked.sourceName, 50)}” · skipped.`,
        null,
        {
          text: tracked.text,
          sourceId: tracked.sourceId,
          sourceName: tracked.sourceName,
          sameTarget: true
        }
      )
    }

    if (namesBrand(text, facts.brands)) {
      const brand = facts.brands.find((name) => namesBrand(text, [name])) ?? facts.brands[0] ?? ''
      return plain('fix', `Names your brand (${brand}). Buyers ask before they know you.`, 'brand')
    }
    const maxWords = onPage ? BUYER_PROMPT_MAX_WORDS : MAX_QUESTION_WORDS
    if (words > maxWords) {
      return plain('fix', `Too long: ${words} words. Google reads up to ${maxWords}.`, 'long')
    }
    if (onPage && words < BUYER_PROMPT_MIN_WORDS) {
      return plain(
        'fix',
        `Too short: ${words} ${words === 1 ? 'word' : 'words'}. Page questions need ${BUYER_PROMPT_MIN_WORDS} to ${BUYER_PROMPT_MAX_WORDS} words.`,
        'short'
      )
    }
    const stageRaw = (row.values.stageRaw ?? '').trim()
    if (stageRaw.length > 0) {
      return plain('fix', `Stage unknown: “${clip(stageRaw, 30)}”. Pick what it means.`, 'stage')
    }
    const marketRaw = (row.values.marketRaw ?? '').trim()
    if (marketRaw.length > 0) {
      return plain('fix', `Market ${clip(marketRaw, 20)} isn't set up for this project.`, 'market')
    }
    const market = (row.values.market ?? '').trim()
    // "Add it" (`addMarket`): the import adds the row's market to the page or topic.
    if (
      market.length > 0 &&
      row.values.addMarket !== '1' &&
      destination !== null &&
      destination.marketIds.length > 0 &&
      !destination.marketIds.includes(market)
    ) {
      return plain(
        'fix',
        `${marketName(facts, market)} isn't checked in ${destination.kind === 'topic' ? 'this topic' : 'this page'}.`,
        'market'
      )
    }
    const page = (row.values.page ?? '').trim()
    if (!onPage && page.length > 0) {
      const checked = checkPageUrl(page, facts.domain, facts.includeSubdomains)
      if (!checked.ok) {
        return plain(
          'fix',
          checked.reason === 'other'
            ? `The page is on another site (${checked.host ?? ''}). Pick a page on ${facts.domain}.`
            : `“${clip(page, 40)}” is not a web address.`,
          'page'
        )
      }
    }

    const kind: 'question' | 'keyword' =
      entity === 'keywords'
        ? 'keyword'
        : !onPage && rules.keywords && promptKindOf(text) === 'keyword'
          ? 'keyword'
          : 'question'
    const elsewhere = facts.questions.exact(probe)
    const near = elsewhere === null ? facts.questions.similar(probe) : null
    let similar: ImportRowCheck | null = null
    if (elsewhere !== null) {
      similar = plain(
        'similar',
        `Also tracked in “${clip(elsewhere.sourceName, 50)}”.`,
        null,
        {
          text: elsewhere.text,
          sourceId: elsewhere.sourceId,
          sourceName: elsewhere.sourceName,
          sameTarget: false
        },
        kind
      )
    } else if (near !== null) {
      const sameTarget = near.item.sourceId === destination?.id
      similar = plain(
        'similar',
        `Close to “${clip(near.item.text, 60)}” (tracked${sameTarget ? '' : ` in ${clip(near.item.sourceName, 40)}`}).`,
        null,
        {
          text: near.item.text,
          sourceId: near.item.sourceId,
          sourceName: near.item.sourceName,
          sameTarget
        },
        kind
      )
    } else if (nearRow !== null) {
      similar = plain('similar', `Close to row ${nearRow + 1} in this list.`, null, null, kind)
    }
    if (similar !== null && !row.keep) return similar

    const key = destination?.id ?? '-'
    const taken = used.get(key) ?? 0
    if (destination !== null && taken >= destination.room) {
      return plain(
        'fix',
        `${destination.kind === 'topic' ? 'This topic' : 'This page'} is full: it holds at most 1,000 questions.`,
        'limit'
      )
    }
    used.set(key, taken + 1)
    const kept = similar?.match
      ? `Kept next to “${clip(similar.match.text, 50)}”.`
      : similar
        ? 'Kept.'
        : null
    if (kind === 'keyword') {
      return plain(
        'keyword',
        kept ?? `${words} ${words === 1 ? 'word' : 'words'}: tracked as a keyword.`,
        null,
        similar?.match ?? null,
        'keyword'
      )
    }
    return plain('new', kept, null, similar?.match ?? null, 'question')
  })
}
