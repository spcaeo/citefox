import type {
  MetricsRequest,
  MetricsResult,
  ReportDownloadRequest,
  ReportDownloadResult,
  ReviewDataResult
} from '@shared/ipc'
import { errorText } from '../../components/errorText'

/**
 * Where the ready reports read their numbers (`reports:metrics`) and save their files
 * (`reports:download`). Tests and the dev harness pass their own.
 */
export interface ReviewClient {
  metrics(request: MetricsRequest): Promise<MetricsResult>
  /** The numbers and the extras (backlinks, page changes, owners, shapes) in one read. */
  review?(request: MetricsRequest): Promise<ReviewDataResult>
  download(request: ReportDownloadRequest): Promise<ReportDownloadResult>
}

export function createLiveReviewClient(): ReviewClient {
  return {
    async metrics(request) {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:metrics'](request)
    },
    async review(request) {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:review'](request)
    },
    async download(request) {
      try {
        const api = window.citefox
        if (!api) throw new Error('The preload bridge is missing.')
        return await api['reports:download'](request)
      } catch (error) {
        return { ok: false, reason: errorText(error, 'Could not save the report.'), nextStep: null }
      }
    }
  }
}
