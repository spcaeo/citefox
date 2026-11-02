import type { Logger } from '../../logging/logger'
import { loadGenerationTemplate, templateHash } from '../../pipeline/templates'
import type { SqliteDatabase } from '../../storage/database'
import {
  CheckTemplateError,
  SHIPPED_CHECK_TEMPLATES,
  renderCheckTemplate,
  type CheckTemplateChoice,
  type CheckTemplateContext,
  type CheckTemplates
} from './report-templates'

/**
 * FR-26.8. The check templates a project's reports render: its own current
 * version of each step, else the app default. Anything unreadable falls back to
 * the shipped body, so a broken template row never stops a check's reports.
 */
export function resolveCheckTemplates(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  logger: Logger
): CheckTemplates {
  return {
    aioGap: choose(appDb, projectDb, 'aio_gap', SHIPPED_CHECK_TEMPLATES.aioGap, logger),
    runSummary: choose(appDb, projectDb, 'run_summary', SHIPPED_CHECK_TEMPLATES.runSummary, logger)
  }
}

function choose(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  kind: 'aio_gap' | 'run_summary',
  shipped: CheckTemplateChoice,
  logger: Logger
): CheckTemplateChoice {
  try {
    const template = loadGenerationTemplate(appDb, kind, undefined, 'templates:get', projectDb)
    return {
      id: template.id,
      body: template.body,
      hash: templateHash(template.body),
      settings: template.settings
    }
  } catch {
    logger.warn('check template fallback', { kind })
    return shipped
  }
}

/**
 * TPL-2. A chosen body that does not render (an unknown variable such as a typo in
 * a project version, or a syntax error) is replaced by the shipped body, loudly in
 * the log, so the check still gets both reports. Every context field is always
 * present, so a body that renders here renders for every prompt of the run.
 */
export function renderableCheckTemplates(
  templates: CheckTemplates,
  logger: Logger
): CheckTemplates {
  return {
    aioGap: renderable(templates.aioGap, SHIPPED_CHECK_TEMPLATES.aioGap, 'aio_gap', logger),
    runSummary: renderable(
      templates.runSummary,
      SHIPPED_CHECK_TEMPLATES.runSummary,
      'run_summary',
      logger
    )
  }
}

function renderable(
  chosen: CheckTemplateChoice,
  shipped: CheckTemplateChoice,
  kind: 'aio_gap' | 'run_summary',
  logger: Logger
): CheckTemplateChoice {
  if (chosen.id === shipped.id && chosen.hash === shipped.hash) return chosen
  try {
    renderCheckTemplate(chosen.body, PROBE_CONTEXT)
    return chosen
  } catch (error) {
    if (!(error instanceof CheckTemplateError)) throw error
    logger.error('check template fallback', {
      kind,
      template: chosen.id,
      outcome: 'template_error'
    })
    return shipped
  }
}

const PROBE_CONTEXT: CheckTemplateContext = {
  page: { url: '', title: '', meta_description: '', h1: '', body: '' },
  market: { country: '', language: '', location: '', device: '' },
  icp: '',
  product: '',
  brand_names: '',
  competitors: '',
  count: '',
  prompts: '',
  aio: { prompt: '', text: '', references: '', status: '' },
  run: {
    aios_shown: '',
    page_cited: '',
    other_own_page: '',
    named_without_link: '',
    invisible: '',
    previous_page_cited: '',
    baseline_page_cited: '',
    content_changed: '',
    content_change: ''
  },
  notes: ''
}
