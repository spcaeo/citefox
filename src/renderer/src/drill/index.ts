/**
 * Drill-downs (REPORT-SPEC "Interaction model", NFR-14): every number opens
 * exactly what it counts. See Docs/ARCHITECTURE.md "Drill-downs".
 */
export { DrillDrawer } from './DrillDrawer'
export { DrillHost } from './DrillHost'
export { useDrill, type DrillApi } from './context'
export { DrillButton, DrillFigure, DrillLink, DrillNumber } from './DrillNumber'
export { DrillPopover } from './DrillPopover'
export {
  idsDrill,
  ownLinksDrill,
  resultsDrill,
  resultsScope,
  specDrill,
  whereDrill,
  type OwnLinkPart
} from './fromResults'
export { drillCsv } from './csv'
export { opaqueId } from './ids'
export { isExternal, openTarget, promptTarget, safeExternalUrl, targetHref } from './targets'
export {
  drillCount,
  drillNoun,
  type DrillItem,
  type DrillItemColumn,
  type DrillRequest,
  type DrillScope,
  type DrillTarget,
  type ItemDrill,
  type ListDrill,
  type PromptDrill,
  type TopicDrill,
  type TopicDrillRow
} from './types'
export { topicDrillCsv } from './csv'
export {
  DrillFilters,
  DrillShowing,
  type DrillChip,
  type DrillFiltersProps
} from './page/DrillFilters'
export {
  DRILL_PREFIX,
  drillHref,
  drillKey,
  drillNames,
  drillValue,
  hasDrillFilters,
  readDrillFilters,
  withoutDrillFilter,
  withoutDrillFilters
} from './page/drillUrl'
export { drillSummary, showingText } from './page/model'
export { useDrillFilters, type DrillFiltersState } from './page/useDrillFilters'
