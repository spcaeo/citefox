import { normalizeExportSections, type ReportSectionId } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import type { PreparedPage } from '../prepare'
import type { ExportDataset } from '../types'
import { buildReportModel } from './build'
import type { ReportBuildInput } from './input'
import type { ReportModel, ReportSectionBuilders } from './types'

/** The report sections a request asks for, in report order, legacy ids mapped. */
export function requestedReportSections(sections: readonly string[]): ReportSectionId[] {
  return normalizeExportSections(sections).filter(
    (section): section is ReportSectionId => section !== 'raw'
  )
}

/** Report input for an export request, after `prepareExport` has picked pages and checks. */
export function reportInput(
  dataset: ExportDataset,
  pages: readonly PreparedPage[],
  request: Pick<ExportRequest, 'scope' | 'sections' | 'timeZone'>,
  now: Date,
  builders?: ReportSectionBuilders
): ReportBuildInput {
  return {
    project: {
      name: dataset.projectName,
      slug: dataset.projectSlug,
      domain: dataset.report.domain,
      clientName: dataset.clientName,
      brandNames: dataset.report.brandNames,
      competitors: dataset.report.competitors,
      includeSubdomains: dataset.report.includeSubdomains,
      brandColor: dataset.report.brandColor
    },
    markets: dataset.report.markets,
    pages,
    scope: request.scope === 'page' && pages.length === 1 ? 'page' : 'project',
    sections: requestedReportSections(request.sections),
    builtAt: now,
    timeZone: request.timeZone,
    answerShapes: dataset.report.answerShapes,
    ...(dataset.report.siteKinds === undefined ? {} : { siteKinds: dataset.report.siteKinds }),
    templates: dataset.report.templates,
    ...(builders === undefined ? {} : { builders })
  }
}

export function reportModelFor(
  dataset: ExportDataset,
  pages: readonly PreparedPage[],
  request: Pick<ExportRequest, 'scope' | 'sections' | 'timeZone'>,
  now: Date,
  builders?: ReportSectionBuilders
): ReportModel {
  return buildReportModel(reportInput(dataset, pages, request, now, builders))
}
