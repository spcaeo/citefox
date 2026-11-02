import type { ReportSectionId } from '@shared/domain'
import type { ReportModel } from '../model/types'

/** One table's CSV: headers and plain cell values, in table order. */
export interface TableData {
  title: string
  columns: readonly string[]
  rows: readonly (readonly (string | number | null)[])[]
  /** Page URLs in the table, for "Copy all URLs". Absent when the table lists no pages. */
  urls?: readonly string[]
}

/** State shared by the section renderers while one report is built. */
export interface RenderContext {
  model: ReportModel
  timeZone: string
  /** Table id → CSV data. Embedded once in `report-data`. */
  tables: Record<string, TableData>
}

/** A sub-heading inside a section, listed under the section in the left nav. */
export interface SubLink {
  id: string
  title: string
}

/**
 * Sections the HTML report adds around the picked ones: the verdict after the cover,
 * "What to do next" after the verdict, "What changed" after the overview, and "How this
 * report was made" last.
 */
export type PerspectiveSectionId = 'verdict' | 'next' | 'what_changed' | 'method'

/** A rendered section: its markup and the nav entry that points at it. */
export interface RenderedSection {
  id: ReportSectionId | 'cover' | PerspectiveSectionId
  anchor: string
  title: string
  html: string
  subs: readonly SubLink[]
}

export function createContext(model: ReportModel): RenderContext {
  return { model, timeZone: model.cover.timeZone, tables: {} }
}
