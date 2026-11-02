import type { EngineId } from '@shared/domain'
import { guessPromptShape, isPromptShape, type PromptShape, type SetupItem } from '@shared/ipc'

/**
 * Step 8's words for each prompt shape (owner feedback 2026-10-25: sell the outcome,
 * "if you do this, this is the outcome you can expect"). `bestIn` is where the shape
 * is asked most; every ticked engine still checks every prompt.
 */
export interface ShapeCopy {
  title: string
  /** One of them: the tag on a prompt row. */
  one: string
  /** What a buyer does. */
  how: string
  /** Shown until Claude's example for this site is there. */
  like: string
  /** What tracking it shows, when Claude gave no outcome of its own. */
  outcome: string
  bestIn: readonly EngineId[]
}

export const SHAPE_COPY: Readonly<Record<PromptShape, ShapeCopy>> = {
  search: {
    title: 'Short searches',
    one: 'Short search',
    how: 'A few words typed into Google.',
    like: 'email to text service',
    outcome:
      'See whether Google’s AI Overview and AI Mode cite your pages on the searches you already rank for, or a rival’s.',
    bestIn: ['google_aio', 'google_ai_mode']
  },
  question: {
    title: 'Questions',
    one: 'Question',
    how: 'One plain question, asked of Google or a chatbot.',
    like: 'how do I send a text from Gmail?',
    outcome:
      'See who AI recommends when a buyer asks straight out, and whether your page is the source it quotes.',
    bestIn: ['google_aio', 'chatgpt', 'perplexity', 'google_ai_mode', 'gemini', 'copilot']
  },
  situation: {
    title: 'Situations',
    one: 'Situation',
    how: 'The buyer’s whole story, the way people ask ChatGPT.',
    like: 'Our alerts stopped when the carrier shut down email-to-text. We are a 50-person IT team. What should we use?',
    outcome:
      'See whether ChatGPT and the others name you when a buyer explains their problem in full, before they ever search for a product.',
    bestIn: ['chatgpt', 'perplexity', 'gemini', 'copilot']
  }
}

/** "Keyword, question or prompt?": the side panel's answer. */
export const TERMS = [
  {
    term: 'Keyword',
    text: 'What people type into Google: a few words. SEO tools track these, and Google’s AI Overview now answers many of them.'
  },
  {
    term: 'Question',
    text: 'A full question. Google’s AI and every chatbot answer it with a short list of sources.'
  },
  {
    term: 'Prompt',
    text: 'Anything typed into an AI, often a whole situation. To ChatGPT all three are prompts, so CiteFox calls them prompts too.'
  }
] as const

/** A prompt's shape: the one it was written or pasted as, else the one it reads as. */
export function shapeOf(item: Pick<SetupItem, 'name' | 'detail'>): PromptShape {
  const said = item.detail.trim()
  return isPromptShape(said) ? said : guessPromptShape(item.name)
}
