import type { PageSummary, ThemePreference } from '@shared/domain'
import type { QuestionSearchHit } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { PAGE_SEARCH_PREVIEW, pageLabel } from '../projects/copy'
import { looksLikePageAddress } from './pickerDrawers/model'
import { pageHash, promptHash } from './routes'
import type { SidebarTopic } from './sidebarTopics'

/** The box's accessible name: it finds screens and actions as well as the project's things. */
export const SEARCH_LABEL =
  'Find anything: screens, settings, reports, help, actions, pages, topics and questions'
/** The box is 140 to 260 px wide, so the visible hint is short; the label names it in full. */
export const SEARCH_PLACEHOLDER = 'Find anything…'
/** Under the empty box: what to type. */
export const SEARCH_TIP = 'Try: competitors, impact review, agency logo, a page or question…'

/** "Find screens, actions, 2,014 pages, topics and questions": the box's tooltip. */
export function searchLabel(foundPageCount: number): string {
  return `Find screens, actions, ${pluralize(foundPageCount, 'page')}, topics and questions`
}

/** Cmd+K (macOS) or Ctrl+K, from anywhere, focuses the top bar search. */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) return false
  return event.metaKey || event.ctrlKey
}

/** The key hint beside the box: ⌘K on macOS, Ctrl K elsewhere. */
export function shortcutHint(): string {
  if (typeof navigator === 'undefined') return '⌘K'
  return /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
}

/** Topics whose title holds every word of `query`, case-insensitive. */
export function matchTopics(
  topics: readonly SidebarTopic[],
  query: string
): readonly SidebarTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return topics.filter((topic) => {
    const title = topic.title.toLowerCase()
    return words.every((word) => title.includes(word))
  })
}

/** A question's wording without its `**` emphasis: the list is one line of plain text. */
export function plainQuestion(text: string): string {
  return text.split('**').join('').trim()
}

/** Topics shown under the box at most; they are filtered here, from the sidebar's list. */
export const TOPIC_PREVIEW = 5

export type SearchGroupId =
  | 'actions'
  | 'screens'
  | 'help'
  | 'topics'
  | 'pages'
  | 'questions'
  | 'competitors'
  | 'fixes'
  | 'reports'
  | 'create'

/** What a "Create" option opens instead of following a link. */
export type SearchCreate = 'new-topic' | 'track-page' | 'add-questions'

/** One result: an option of the listbox, opened by its `href`. */
export interface SearchOption {
  /** Unique across groups, so the active option survives new results arriving. */
  key: string
  href: string
  text: string
  /** What it belongs to (a question's page or topic). Null for pages and topics. */
  detail: string | null
  /** A "Create" option: the drawer it opens. Its `href` is empty. */
  create?: SearchCreate
  /** A "Switch theme" action: the look it picks. Its `href` is empty. */
  theme?: ThemePreference
}

export interface SearchGroup {
  id: SearchGroupId
  heading: string
  options: readonly SearchOption[]
}

/**
 * The result groups in display order: actions, screens and help (from the catalog),
 * topics (from the sidebar), pages, questions, then competitors, fixes and
 * reports, each left out while empty or still loading. A question opens its
 * Prompt detail, which takes a topic id as its page id the way the Questions
 * screen links it.
 */
export function searchGroups(input: {
  actions?: readonly SearchOption[]
  screens?: readonly SearchOption[]
  help?: readonly SearchOption[]
  topics: readonly SidebarTopic[]
  pages: readonly PageSummary[] | null
  questions: readonly QuestionSearchHit[] | null
  competitors?: readonly SearchOption[]
  fixes?: readonly SearchOption[]
  reports?: readonly SearchOption[]
}): SearchGroup[] {
  const groups: SearchGroup[] = []
  const add = (id: SearchGroupId, heading: string, options: readonly SearchOption[] = []): void => {
    if (options.length > 0) groups.push({ id, heading, options })
  }
  add('actions', 'Actions', input.actions)
  add('screens', 'Screens & settings', input.screens)
  add('help', 'Help', input.help)
  const topics = input.topics.slice(0, TOPIC_PREVIEW)
  if (topics.length > 0) {
    groups.push({
      id: 'topics',
      heading: 'Topics',
      options: topics.map((topic) => ({
        key: `topic:${topic.id}`,
        href: topic.href,
        text: topic.title,
        detail: null
      }))
    })
  }
  const pages = (input.pages ?? []).slice(0, PAGE_SEARCH_PREVIEW)
  if (pages.length > 0) {
    groups.push({
      id: 'pages',
      heading: 'Pages',
      options: pages.map((page) => ({
        key: `page:${page.id}`,
        href: pageHash(page.id),
        text: pageLabel(page),
        detail: null
      }))
    })
  }
  const questions = input.questions ?? []
  if (questions.length > 0) {
    groups.push({
      id: 'questions',
      heading: 'Questions',
      options: questions.map((hit) => ({
        key: `question:${hit.sourceId}:${hit.promptId}`,
        href: promptHash(hit.sourceId, hit.promptId),
        text: plainQuestion(hit.text),
        detail: `${hit.sourceKind === 'topic' ? 'Topic' : 'Page'}: ${hit.sourceName}`
      }))
    })
  }
  add('competitors', 'Competitors', input.competitors)
  add('fixes', 'Fixes', input.fixes)
  add('reports', 'Reports', input.reports)
  return groups
}

/**
 * When nothing matches, the typed text can start something new: a topic, a
 * page to track (when it looks like an address or path), or questions.
 */
export function createGroup(query: string): SearchGroup {
  const text = query.trim()
  const options: SearchOption[] = [
    {
      key: 'create:topic',
      href: '',
      text: `Create topic “${text}”`,
      detail: null,
      create: 'new-topic'
    }
  ]
  if (looksLikePageAddress(text)) {
    options.push({
      key: 'create:page',
      href: '',
      text: `Track page ${text}`,
      detail: null,
      create: 'track-page'
    })
  }
  options.push({
    key: 'create:questions',
    href: '',
    text: `Add questions: “${text}”`,
    detail: null,
    create: 'add-questions'
  })
  return { id: 'create', heading: 'Create', options }
}
