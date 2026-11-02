import type { ReportSectionId } from '@shared/domain'
import type { SortableSiteKind } from '@shared/report/site-kinds'
import type { StoredAnswerShape } from '../../analytics/answer-shape/vocabulary'
import type { PreparedPage } from '../prepare'
import type { ReportSectionBuilders, TemplateUse } from './types'

/** Project facts the report needs beyond the pages. */
export interface ReportProjectFacts {
  name: string
  slug: string
  /** Bare own domain, such as `example.com`. */
  domain: string
  clientName: string | null
  brandNames: readonly string[]
  competitors: readonly string[]
  includeSubdomains: boolean
  /** CSS colour from project settings. Null uses the CiteFox accent. */
  brandColor: string | null
}

export interface ReportMarketFacts {
  id: string
  country: string
  language: string
}

/**
 * Everything {@link buildReportModel} reads. Plain data: the export source has already
 * read the project file, and `prepareExport` has applied scope, markets and checks.
 */
export interface ReportBuildInput {
  project: ReportProjectFacts
  /** Every market in the project. Labels come from here. */
  markets: readonly ReportMarketFacts[]
  pages: readonly PreparedPage[]
  /** `page` when exactly one page was picked with the page scope. */
  scope: 'page' | 'project'
  sections: readonly ReportSectionId[]
  builtAt: Date
  timeZone: string
  /** Stored classifications for the overviews in scope, any order. */
  answerShapes: readonly StoredAnswerShape[]
  /** Kinds Claude gave cited domains, by bare domain. Absent: built-in list, else `other`. */
  siteKinds?: Readonly<Record<string, SortableSiteKind>>
  /** Template versions behind the data (cover). */
  templates: readonly TemplateUse[]
  builders?: ReportSectionBuilders
}

export const DEFAULT_BRAND_COLOR = '#C2410C'
