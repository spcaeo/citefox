import type { CommunityAio, Market, PromptCheckStatus, VideoIdea } from '@shared/domain'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../../drill'
import type { AioDrill } from '../types'
import { formatMoment } from '../../utils/dates'
import { marketName, statusLabel } from './model'

/** Drawer requests over the screen's answers. */
export interface VideoDrills {
  /** The shared drawer request for the answers behind one number. */
  of: (spec: AioDrill) => ItemDrill
  /** The keys from one market. */
  inMarket: (keys: readonly string[], marketId: string) => string[]
}

/** Binds the drill builders to one `videos:get` result. */
export function videoDrills(
  aios: readonly CommunityAio[],
  markets: readonly Market[]
): VideoDrills {
  return {
    of: (spec) => aioDrill(spec, aios, markets),
    inMarket: (keys, marketId) => marketKeys(aios, keys, marketId)
  }
}

/** Answers come from many pages, markets and checks: each row carries its own target. */
export const VIDEO_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

const SUMMARY: readonly { label: string; group: string }[] = [
  { label: 'Target page', group: 'page_cited' },
  { label: 'Your other page', group: 'other_own_page' },
  { label: 'Named, not linked', group: 'brand_mentioned' },
  { label: 'Not cited', group: 'not_cited' }
]

function plain(label: string): string {
  return label.split('**').join('')
}

function groupOf(status: PromptCheckStatus): string {
  return status === 'no_aio' || status === 'error' ? 'other' : status
}

/** Prompt detail for that prompt, market and check. A latest answer follows the latest check. */
export function aioTarget(aio: CommunityAio): DrillTarget {
  return {
    kind: 'prompt',
    pageId: aio.pageId,
    promptId: aio.promptId,
    marketId: aio.marketId,
    runId: aio.latest ? null : aio.runId
  }
}

function aioItem(aio: CommunityAio, markets: readonly Market[]): DrillItem {
  const label = plain(aio.label)
  return {
    id: aio.key,
    primary: label,
    secondary: `Question ${aio.promptPosition} · ${aio.pageLabel}`,
    target: aioTarget(aio),
    cells: {
      market: marketName(markets, aio.marketId),
      status: `${statusLabel(aio.status)}${aio.named === true && aio.status !== 'brand_mentioned' ? ' · named' : ''}`,
      checked: formatMoment(aio.checkedAt)
    },
    detail: aio.text.trim() !== '' && aio.text !== label ? `> ${aio.text}` : null,
    group: groupOf(aio.status)
  }
}

/**
 * One row per key, in key order. A key whose answer is no longer stored still
 * gets a row, so the drawer total always equals the number clicked (NFR-14).
 */
export function aioDrillItems(
  aios: readonly CommunityAio[],
  markets: readonly Market[],
  keys: readonly string[]
): DrillItem[] {
  const byKey = new Map(aios.map((aio) => [aio.key, aio]))
  return keys.map((key) => {
    const aio = byKey.get(key)
    if (aio !== undefined) return aioItem(aio, markets)
    return {
      id: key,
      primary: 'An answer from an older check',
      secondary: 'CiteFox no longer keeps this check, so it cannot open.',
      group: 'other'
    }
  })
}

/** The shared drill drawer for a list of answers (REPORT-SPEC "Interaction model"). */
export function aioDrill(
  spec: AioDrill,
  aios: readonly CommunityAio[],
  markets: readonly Market[]
): ItemDrill {
  return {
    kind: 'items',
    id: spec.id,
    title: spec.title,
    description: spec.description,
    noun: ['answer', 'answers'],
    primaryLabel: 'Question',
    columns: [
      { id: 'market', label: 'Market', width: 'minmax(96px, 0.8fr)' },
      { id: 'status', label: 'Your page', width: 'minmax(110px, 0.9fr)' },
      { id: 'checked', label: 'Checked', width: '110px' }
    ],
    items: aioDrillItems(aios, markets, spec.keys),
    summary: SUMMARY,
    note: 'Counts are answers: one question, in one market, in one check. Select a row to open Question detail in that market and check.',
    scope: VIDEO_SCOPE
  }
}

/** The idea's evidence: latest answers in its prompts that cite a YouTube video. */
export function evidenceDrill(idea: VideoIdea): AioDrill {
  return {
    id: `evidence-${idea.id}`,
    title: 'Overviews showing a video',
    description: `Latest overviews for this idea's questions that cite a YouTube video: "${idea.question}"`,
    keys: idea.evidenceKeys
  }
}

/** The answers in `keys` from one market. */
export function marketKeys(
  aios: readonly CommunityAio[],
  keys: readonly string[],
  marketId: string
): string[] {
  const byKey = new Map(aios.map((aio) => [aio.key, aio]))
  return keys.filter((key) => byKey.get(key)?.marketId === marketId)
}

/** Each prompt of an idea with its page, in position order, for Prompt detail links. */
export function ideaPrompts(
  idea: Pick<VideoIdea, 'prompts'>
): { promptId: string; pageId: string; position: number }[] {
  const seen = new Set<string>()
  return [...(idea.prompts ?? [])]
    .sort((a, b) => a.position - b.position)
    .filter((prompt) => {
      if (seen.has(prompt.promptId)) return false
      seen.add(prompt.promptId)
      return true
    })
}
