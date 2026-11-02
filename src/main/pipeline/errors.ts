import { redactString } from '../logging/redact'

/**
 * A page-setup failure. The message says what failed and `nextStep` says what
 * to do (NFR-10). The message is redacted before it is stored (NFR-5).
 */
export type PipelineErrorCode =
  | 'schema_validation'
  | 'brand_in_prompt'
  | 'quote_not_on_page'
  | 'fetch_failed'
  | 'template'
  | 'not_found'

export class PipelineError extends Error {
  readonly code: PipelineErrorCode
  readonly nextStep: string

  constructor(
    message: string,
    options: { code: PipelineErrorCode; nextStep: string; secrets?: readonly string[] }
  ) {
    super(redactString(message, { secrets: options.secrets }))
    this.name = 'PipelineError'
    this.code = options.code
    this.nextStep = options.nextStep
  }
}

export interface ValidationProblem {
  code: PipelineErrorCode
  message: string
}
