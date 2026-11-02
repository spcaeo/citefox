/**
 * Scope: "which pages?" for Check now, Export, Reports, Alerts and the page
 * pickers in Site structure. One shape (`Scope`), one loader
 * (`useScopeOptions`), one searchable picker that stays fast at 2,000+ pages
 * (`ItemPicker`), and the kind list + picker (`ScopeChooser`).
 */
export * from './types'
export * from './model'
export { ItemPicker, PICKER_ROW_CAP, type ItemPickerProps } from './ItemPicker'
export { MarketChips, ScopeChooser, type ScopeChooserProps } from './ScopeChooser'
export {
  createScopeSource,
  loadScopeOptions,
  useScopeOptions,
  type ScopeOptionsState,
  type ScopeSource
} from './useScopeOptions'
