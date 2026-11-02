/**
 * The sidebar Topics list: `useTopicNav(projectId)` gives each topic's name,
 * questions goal % and route. Kept apart from the screen so the shell can use
 * it without loading the results chunk.
 */
export { useTopicNav } from './hooks/useTopicNav'
export type { TopicNavItem } from './types'
