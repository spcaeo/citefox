import { createContext, useContext } from 'react'

/**
 * One tracked topic in the sidebar's "Topics" group: the shape of the topic
 * screens' `useTopicNav(projectId)` (route `#/topics/<pageId>`).
 */
export interface SidebarTopic {
  id: string
  title: string
  /**
   * The topic's headline: target page cited ÷ searches with an AI Overview, the same
   * number as the Topics list, the topic header and Progress. Null before the first check.
   */
  goalPct: number | null
  href: string
}

/**
 * The open project's topics for the sidebar. Empty until the topic screens
 * provide them (wrap the shell in a provider fed by `useTopicNav`).
 */
export const SidebarTopicsContext = createContext<readonly SidebarTopic[]>([])

export function useSidebarTopics(): readonly SidebarTopic[] {
  return useContext(SidebarTopicsContext)
}

/** "42%", or "—" before the first check. */
export function topicGoalLabel(goalPct: number | null): string {
  return goalPct === null ? '—' : `${Math.round(goalPct)}%`
}

/** The sidebar tooltip: "22% target page cited", or "Not checked yet". */
export function topicGoalTip(goalPct: number | null): string {
  return goalPct === null ? 'Not checked yet' : `${Math.round(goalPct)}% right page cited`
}
