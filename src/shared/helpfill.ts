/**
 * The pure parts of "✦ Help me fill this" that main and the renderer share: the
 * chatbots the user can pick, how each one opens (prefilled with `?q=` only
 * where the bot reads it and the link stays short), and the summary banner's
 * words. Docs/HELPFILL.md.
 */

import type { HelpFillCounts } from './ipc/helpfill'

/** The two ways (`help=` on the URL). */
export const HELPFILL_WAYS = ['describe', 'chatbot'] as const
export type HelpFillWay = (typeof HELPFILL_WAYS)[number]

export function isHelpFillWay(value: unknown): value is HelpFillWay {
  return value === 'describe' || value === 'chatbot'
}

/** The chatbots, in the picker's order (`bot=` on the URL). */
export const HELPFILL_BOTS = ['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot'] as const
export type HelpFillBot = (typeof HELPFILL_BOTS)[number]

export function isHelpFillBot(value: unknown): value is HelpFillBot {
  return typeof value === 'string' && (HELPFILL_BOTS as readonly string[]).includes(value)
}

export interface HelpFillBotSpec {
  id: HelpFillBot
  name: string
  /** The one or two letters on its mark (text only, no brand artwork). */
  initial: string
  /** Where "Open <bot>" goes when the prompt cannot ride along. */
  home: string
  /** The link with the prompt filled in, or null when the bot has no such link. */
  prefill: ((encoded: string) => string) | null
}

export const HELPFILL_BOT_SPECS: Readonly<Record<HelpFillBot, HelpFillBotSpec>> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    initial: 'G',
    home: 'https://chatgpt.com/',
    prefill: (q) => `https://chatgpt.com/?q=${q}`
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    initial: 'P',
    home: 'https://www.perplexity.ai/',
    prefill: (q) => `https://www.perplexity.ai/search?q=${q}`
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    initial: 'C',
    home: 'https://claude.ai/new',
    prefill: (q) => `https://claude.ai/new?q=${q}`
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    initial: 'G',
    home: 'https://gemini.google.com/app',
    // Gemini has no link that fills in a prompt.
    prefill: null
  },
  copilot: {
    id: 'copilot',
    name: 'Copilot',
    initial: 'C',
    home: 'https://copilot.microsoft.com/',
    prefill: (q) => `https://copilot.microsoft.com/?q=${q}`
  }
}

/** Longest prefilled link: longer links are cut or refused by browsers and the bots. */
export const HELPFILL_PREFILL_MAX = 2000

export interface ChatbotOpen {
  url: string
  /** True when the link carries the prompt; false: copy it, then open the home page. */
  prefilled: boolean
}

/** How "Open <bot>" opens: with the prompt in the link when the bot reads `?q=` and it fits. */
export function chatbotOpen(bot: HelpFillBot, prompt: string): ChatbotOpen {
  const spec = HELPFILL_BOT_SPECS[bot]
  if (spec.prefill !== null) {
    const url = spec.prefill(encodeURIComponent(prompt))
    if (url.length <= HELPFILL_PREFILL_MAX) return { url, prefilled: true }
  }
  return { url: spec.home, prefilled: false }
}

/**
 * The summary banner: "Read 15 rows. 2 were close to questions you track and were
 * merged. 1 named Example Co and was set aside. 12 are ready."
 */
export function helpFillSummary(
  counts: HelpFillCounts,
  noun: readonly [string, string],
  brand: string | null
): string {
  const plural = noun[1]
  const was = (n: number): string => (n === 1 ? 'was' : 'were')
  const parts = [`Read ${counts.read} ${counts.read === 1 ? 'row' : 'rows'}.`]
  if (counts.tracked > 0) {
    parts.push(
      `${counts.tracked} ${was(counts.tracked)} close to ${plural} you track and ${was(counts.tracked)} merged.`
    )
  }
  if (counts.repeats > 0) {
    parts.push(`${counts.repeats} repeated another row and ${was(counts.repeats)} merged.`)
  }
  if (counts.setAside > 0) {
    parts.push(
      `${counts.setAside} named ${brand ?? 'your brand'} and ${was(counts.setAside)} set aside.`
    )
  }
  parts.push(
    counts.ready === 0
      ? `None are ready.`
      : `${counts.ready} ${counts.ready === 1 ? 'is' : 'are'} ready.`
  )
  return parts.join(' ')
}
