import { registerAssists } from '../registry'
import type { AssistDefinition } from '../types'
import { ALERT_ASSISTS } from './alerts'
import { AUDIENCE_ASSISTS } from './audience'
import { CITATION_ASSISTS } from './citations'
import { COMMUNITY_ASSISTS } from './communities'
import { FIX_LOOP_ASSISTS } from './fix-loop'
import { GAP_ASSISTS } from './gaps'
import { HISTORY_ASSISTS } from './history'
import { MARKET_ASSISTS } from './markets'
import { MATCH_PAGES_ASSISTS } from './match-pages'
import { OVERVIEW_READ_ASSISTS } from './overview-read'
import { PAGE_ASSISTS } from './page'
import { PROGRESS_ASSISTS } from './progress'
import { PROMPT_ASSISTS } from './prompts'
import { REPORT_ASSISTS } from './report'
import { RESULT_ASSISTS } from './results'
import { STATUS_ASSISTS } from './status'
import { TEMPLATE_ASSISTS } from './template'

/**
 * Every shipped assist, registered once on first use. Each screen's assists live
 * in their own module here; another area adds its module to this list.
 */
export const SHIPPED_ASSISTS: readonly (readonly AssistDefinition[])[] = [
  PAGE_ASSISTS,
  AUDIENCE_ASSISTS,
  PROMPT_ASSISTS,
  GAP_ASSISTS,
  RESULT_ASSISTS,
  OVERVIEW_READ_ASSISTS,
  PROGRESS_ASSISTS,
  MARKET_ASSISTS,
  STATUS_ASSISTS,
  REPORT_ASSISTS,
  TEMPLATE_ASSISTS,
  COMMUNITY_ASSISTS,
  HISTORY_ASSISTS,
  FIX_LOOP_ASSISTS,
  CITATION_ASSISTS,
  ALERT_ASSISTS,
  MATCH_PAGES_ASSISTS
]

let registered = false

export function ensureShippedAssists(): void {
  if (registered) return
  registered = true
  for (const group of SHIPPED_ASSISTS) registerAssists(group)
}
