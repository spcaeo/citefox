/**
 * v2 "Spruce & Fox" shared components (Docs/TOPICS-SPEC.md §1,
 * Mockups/v2/Theme.dc.html). Screens import from here only:
 *
 *   import { Button, ListGrid, KpiTile } from '../ui'
 *
 * Styles live in ui/ui.css, ui/kpi.css, ui/layout.css, ui/panels.css,
 * ui/controls.css and ui/list-grid.css (shared layer, imported once from
 * styles.css). Every class starts with `ui-`.
 */
export { UiIcon, type UiIconName } from './UiIcon'
export { Button, LinkButton, type ButtonProps } from './Button'
export {
  buttonClass,
  tintProps,
  type ButtonSize,
  type ButtonVariant,
  type CardTint
} from './classes'
export { IconButton, type IconButtonProps } from './IconButton'
export { MenuButton, type MenuButtonProps, type MenuItem, type MenuTriggerProps } from './Menu'
export {
  SegmentedControl,
  type SegmentOption,
  type SegmentedControlProps
} from './SegmentedControl'
export { RowMenu, type RowMenuProps } from './RowMenu'
export { SectionMenu, type SectionMenuProps } from './SectionMenu'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { SectionHead, type SectionHeadProps } from './SectionHead'
export {
  ListGrid,
  type ListGridProps,
  type ListColumn,
  type ListGroup,
  type ListFilter,
  type ListEngineFilter,
  type ListBulkContext,
  type ListFooterInfo,
  type ListSortValue,
  type ListTree,
  type ListTreeGroup,
  type ListTreeStep
} from './listGrid'
export { treeUrlKeys } from './listGrid/tree/useTreeState'
export { columnsFit, fitColumns, GRID_CARD_BORDERS, type FitOptions } from './listGrid/fit'
export { FilterMenu } from './listGrid/FilterMenu'
export { filtersActive, type FilterChoice, type FilterGroup } from './listGrid/filters'
export { useElementWidth } from './listGrid/useElementWidth'
export { Tabs, TabPanel, type TabItem, type TabsProps, type TabsSize } from './Tabs'
export { ViewTabs, type ViewTabItem, type ViewTabsProps } from './ViewTabs'
export { VIEW_ICONS, VIEW_LABELS, type ScreenView } from './viewTabsModel'
export {
  ipcScreenViewStore,
  useScreenView,
  type ScreenViewOptions,
  type ScreenViewState,
  type ScreenViewStore
} from './useScreenView'
export { PageNav, type PageNavLink, type PageNavProps, type PageNavStep } from './PageNav'
export { COPIED_MS, DomainText, UrlText, type UrlTextProps, type UrlTextVariant } from './UrlText'
export { PathText, type PathTextProps, type RevealResult } from './PathText'
export { CopyText, type CopyTextProps } from './CopyText'
export { SecretField, type SecretFieldProps } from './SecretField'
export { revealLabel } from './urlTextModel'
export { Chip, Badge, type ChipProps, type ChipTone } from './Chip'
export { ResultChip, type ResultChipProps } from './ResultChip'
export {
  addResults,
  bucketLabel,
  bucketLegend,
  bucketOfCheck,
  bucketOfResult,
  countResults,
  isResultBucket,
  NO_RESULTS,
  RESULT_BUCKETS,
  RESULT_TONES,
  resultBarText,
  resultBucket,
  resultOfCheck,
  totalResults,
  whatToDo,
  type ResultBucket,
  type ResultBucketInfo,
  type ResultCounts,
  type ResultKind,
  type ResultTone
} from './resultTones'
export { ResultBar, ResultDot, type ResultBarProps } from './ResultBar'
export { GOOGLE_WORDS, resultWords, useResultWords, type ResultWords } from './resultWords'
export { ResultWordsProvider } from './ResultWordsProvider'
export { GroupHint, type GroupHintProps } from './GroupHint'
export { Dropdown, type DropdownGroup, type DropdownOption, type DropdownProps } from './Dropdown'
export { ChangeCell, type ChangeCellProps, type ChangeTone } from './ChangeCell'
export { ChipInput, type ChipInputProps } from './ChipInput'
export { addChips } from './chipList'
export { GoalBar, type GoalBarProps, type GoalBand } from './GoalBar'
export { KpiStrip, KpiTile, type KpiTileProps, type KpiTrend } from './KpiTile'
export { Stepper, type StepperProps, type StepperStep } from './Stepper'
export { WayList, WayNote, type WayOption } from './WayList'
export { WizardFooter, type WizardFooterProps, type WizardPrimary } from './WizardFooter'
export { Panel, RightRail, type PanelProps } from './Panel'
export {
  SuggestionCard,
  type SuggestionCardProps,
  type SuggestionItem,
  type SuggestionStatus
} from './SuggestionCard'
export {
  useAiSuggestion,
  suggestionFootnote,
  suggestionItems,
  type AiSuggestion,
  type AiSuggestionProps
} from './useAiSuggestion'
export { AiMenu, type AiMenuProps, type AiAction } from './AiMenu'
export { AssistProgress, type AssistProgressProps } from './AssistProgress'
export { formatElapsed, usePrefersReducedMotion } from './assistProgressModel'
export { BusyBar, BusyLine, BusyMark, type BusyLineProps } from './Busy'
export {
  busyTiming,
  formatUsual,
  SLOW_FACTOR,
  SLOW_TEXT,
  type BusyState,
  type BusyTiming,
  type UsualRange
} from './busyModel'
export { useBusyAnnounce, useElapsed, useNow, type BusyAnnounceOptions } from './useBusy'
export {
  useAssistProgress,
  AssistProgressStore,
  IDLE_PROGRESS,
  type AssistProgressView,
  type AssistStepView,
  type AssistProgressMatch
} from './useAssistProgress'
export { ClaudeStatusChip, ClaudeStatusLine } from './ClaudeStatusChip'
export {
  claudeCapsuleText,
  claudeChipModel,
  type ClaudeChipModel,
  type ClaudeChipTone
} from './claudeChip'
export {
  PermissionsContext,
  usePermissions,
  type PermissionsContextValue
} from './permissionsContext'
export {
  useAssistMenu,
  type AssistMenu,
  type AssistMenuAction,
  type AssistMenuScope
} from './useAssistMenu'
export {
  AI_MENU_FOOTER,
  aiMenuItems,
  clampPercent,
  goalBarText,
  stepStates,
  tabDomId,
  tabPanelDomId,
  urlTextHref,
  type StepState
} from './componentModels'
export { Confirm, type ConfirmProps } from './Confirm'
export {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerLevelContext,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  DrawerSkeleton,
  ExpertOptions,
  useDrawerLevel,
  type DrawerAction,
  type DrawerCrumb,
  type DrawerFieldIds,
  type DrawerFooterSpec,
  type DrawerGuardCopy,
  type DrawerLevelValue,
  type DrawerProps,
  type DrawerSectionProps,
  type DrawerSpan,
  type DrawerStep
} from './Drawer'
export { UndoToastHost } from './UndoToast'
export {
  showUndo,
  hideUndo,
  useUndoToast,
  UNDO_TOAST_MS,
  type UndoToastSpec,
  type UndoToastState
} from './undoStore'
export {
  PickerSelect,
  PICKER_NEW_VALUE,
  type PickerGroup,
  type PickerOption,
  type PickerSelectProps
} from './PickerSelect'
export {
  HelpFill,
  HelpFillPair,
  SummaryBanner,
  createHelpFillSource,
  openInBrowser,
  botParam,
  rememberBot,
  rememberedBot,
  useHelpFillUrl,
  wayParam,
  type HelpFillBot,
  type HelpFillChatbotCopy,
  type HelpFillChip,
  type HelpFillPairAction,
  type HelpFillDescribeCopy,
  type HelpFillProps,
  type HelpFillSource,
  type HelpFillUrlState,
  type HelpFillWay
} from './HelpFill'
export {
  BarFill,
  ChartHeadline,
  countTicks,
  DeltaPill,
  MarkerDot,
  MARKER_WHO,
  MEASURE_DAYS,
  rateTicks,
  Sparkline,
  TrackingChangesContext,
  trackingEvents,
  TrendChart,
  type AxisControlArgs,
  type BarTone,
  type ChartEvent,
  type MarkerKind,
  type PointControlArgs,
  type TrendChartProps,
  type TrendPoint,
  type TrendSeries,
  type VerdictTone
} from './chart'
export { ExportMenu, FilterBar, SearchBox, ToolButton, ToolGroup } from './Tools'
export { TOOL_KINDS, type ToolKind } from './toolKinds'
