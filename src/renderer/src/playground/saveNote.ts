import type { PlaygroundSavePart } from '@shared/ipc'
import { pageHash, readHash, type PageTabId } from '../shell/routes'

/** What "Save to project" wrote, and where to open it. */
export interface SaveNote {
  /** The sentence before the link, such as "Saved Prompts to TextBolt." */
  text: string
  /** The sentence after the link. */
  after: string
  pageId: string | null
  /** The part to open first. Null when nothing was written. */
  part: PlaygroundSavePart | null
  /** True when the page is in the open project, so the link can open it. */
  inOpenProject: boolean
  projectName: string
}

const PART_TAB: Readonly<Record<Exclude<PlaygroundSavePart, 'pageRead'>, PageTabId>> = {
  buyerProfile: 'audience',
  prompts: 'prompts',
  coverage: 'gaps',
  aioChecks: 'results'
}

/** The saved part's screen: Page read, or the page tab that shows it. */
export function savedPartHref(pageId: string, part: PlaygroundSavePart): string {
  return part === 'pageRead' ? readHash(pageId) : pageHash(pageId, PART_TAB[part])
}

/** The first written part in the order a reader would open them. */
export function firstOpenablePart(parts: readonly PlaygroundSavePart[]): PlaygroundSavePart | null {
  const order: readonly PlaygroundSavePart[] = [
    'prompts',
    'buyerProfile',
    'coverage',
    'aioChecks',
    'pageRead'
  ]
  return order.find((part) => parts.includes(part)) ?? null
}
