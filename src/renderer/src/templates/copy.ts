import {
  PAGE_VARIABLE_HELP,
  TEMPLATE_VARIABLES,
  templateKindInfo,
  type GenerationTemplate,
  type TemplateVariable
} from '@shared/domain'

/** Display copy from Templates.dc.html, limited to the three contract templates. */
export const TEMPLATE_COPY: Readonly<Record<string, { description: string }>> = {
  'buyer-profile': {
    description:
      'Describes who reads the page and buys from it. Runs once per page, and again if the page changes a lot.'
  },
  'buyer-prompts': {
    description:
      'Writes the buyer questions CiteFox checks in Google. Questions never contain your brand names.'
  },
  coverage: {
    description:
      'Rates how well the page answers each question and suggests one action. Reruns only when the page content changed.'
  },
  'answer-shape': {
    description:
      "Classifies each AI Overview's text blocks into the fixed answer-shape vocabulary for reports."
  }
}

/** What each template variable holds. Names are the contract identifiers, not Jinja paths. */
export const VARIABLE_HELP: Readonly<Record<TemplateVariable, string>> = PAGE_VARIABLE_HELP

/** Rows on the Settings screen. One row per kind, the app-wide default. */
export const SETTINGS_TEMPLATE_ROWS = [
  { kind: 'buyer_profile', file: 'icp.md', usedFor: 'Buyer profile' },
  { kind: 'buyer_prompts', file: 'buyer_prompts.md', usedFor: 'Writing buyer questions' },
  { kind: 'coverage_matrix', file: 'coverage_matrix.md', usedFor: 'Content gap table' },
  { kind: 'answer_shape', file: 'answer_shape.md', usedFor: 'Answer shape in reports' }
] as const

/** One file name per kind, from Templates.dc.html, for shipped and user templates. */
export function templateFile(template: Pick<GenerationTemplate, 'kind'>): string {
  return templateKindInfo(template.kind).file
}

export function templateDescription(template: GenerationTemplate): string {
  return TEMPLATE_COPY[template.id]?.description ?? ''
}

export function variableToken(name: TemplateVariable): string {
  return `{{ ${name} }}`
}

export const VARIABLE_ROWS: readonly TemplateVariable[] = TEMPLATE_VARIABLES
