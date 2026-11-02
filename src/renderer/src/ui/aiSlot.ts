import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
  type RefObject
} from 'react'
import type { MenuItem } from './Menu'

/**
 * Where the shared components put the ✦ Ask CiteFox affordances. The app shell
 * fills it (assistant/AiSlotProvider) so a KPI tile, a section head and a
 * section's AI menu offer questions about themselves, with no change on the
 * screens that use them. Outside the shell (unit tests, the gallery) it is
 * empty and the components draw nothing extra.
 */
export interface AiSlot {
  /** The ✦ in a KPI tile's head. `valueRef` holds the drawn number. */
  Kpi?: ComponentType<AiKpiSlotProps>
  /** The ✦ menu at a section head that has no AI menu of its own. */
  section?: (props: { title: string }) => ReactNode
  /** The last line of a section's own AI menu: "Ask CiteFox about {title}…". */
  menuItem?: (title: string | null) => MenuItem | null
}

export interface AiKpiSlotProps {
  label: string
  valueRef: RefObject<HTMLElement | null>
  trend: string | null
  goal: boolean
}

export const AiSlotContext = createContext<AiSlot | null>(null)

/** The section a section's AI menu sits in, so its "Ask about…" line names it. */
export const AiSectionTitleContext = createContext<string | null>(null)

export function useAiSlot(): AiSlot | null {
  return useContext(AiSlotContext)
}
